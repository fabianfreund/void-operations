'use strict';

/**
 * Physics System
 *
 * Handles offline-capable drone simulation:
 *   - Calculates travel time and fuel consumption between locations
 *   - Runs a recurring tick that advances all active drone tasks
 *   - Emits socket events to online clients when their drones update
 */

const DroneModel = require('../models/drone');
const world = require('../../config/world.json');
const droneSpecs = require('../../config/drones.json');
const economy = require('../../config/economy.json');
const db = require('../../db/init');
const { log } = require('../ui/console');

// ─── Geometry helpers ────────────────────────────────────────────────────────

function distance(locA, locB) {
  const a = world[locA];
  const b = world[locB];
  if (!a || !b) throw new Error(`Unknown location: ${locA} or ${locB}`);
  const dx = a.coordinates.x - b.coordinates.x;
  const dy = a.coordinates.y - b.coordinates.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Calculate travel parameters between two world locations.
 * @param {string} fromId  - world location key
 * @param {string} toId    - world location key
 * @param {string} typeId  - drone spec key
 * @returns {{ distanceKm: number, durationMs: number, fuelCost: number }}
 */
function travelParams(fromId, toId, typeId) {
  const spec = droneSpecs[typeId];
  if (!spec) throw new Error(`Unknown drone type: ${typeId}`);

  const distanceKm = distance(fromId, toId);
  const durationMs = Math.ceil((distanceKm / spec.speed_kmh) * 3600 * 1000);
  const fuelCost = distanceKm * spec.fuel_burn_rate_l_per_km;

  return { distanceKm, durationMs, fuelCost };
}

// ─── Tick logic ───────────────────────────────────────────────────────────────

const logEvent = db.prepare(
  "INSERT INTO event_log (event_type, payload) VALUES (?, ?)"
);

/**
 * Resolve all drones whose ETA has passed.
 * @param {import('socket.io').Server} io - optional, to push updates to online clients
 */
function tick(io) {
  const nowSec = Math.floor(Date.now() / 1000);
  const activeDrones = DroneModel.findAllActive();

  for (const drone of activeDrones) {
    if (!drone.task_eta_at || drone.task_eta_at > nowSec) continue;

    const spec = DroneModel.spec(drone.type_id);

    if (drone.status === 'travelling') {
      // Arrived at destination
      DroneModel.updateStatus(drone.id, {
        status: 'idle',
        location_id: drone.destination_id,
        destination_id: null,
        task_started_at: null,
        task_eta_at: null,
      });

      logEvent.run('drone_arrived', JSON.stringify({
        drone_id: drone.id,
        location: drone.destination_id,
      }));

      pushToOwner(io, drone.owner_id, 'drone:arrived', {
        droneId: drone.id,
        droneName: drone.name,
        location: drone.destination_id,
      });
    }

    if (drone.status === 'mining') {
      // Mining cycle complete — add resources to cargo
      const location = world[drone.location_id];
      if (location?.resources?.length) {
        const resource = location.resources[
          Math.floor(Math.random() * location.resources.length)
        ];
        const yieldKg = parseFloat(
          (spec.mining_power * (location.richness ?? 0.5) * (0.8 + Math.random() * 0.4)).toFixed(2)
        );

        DroneModel.addInventory(drone.id, resource, yieldKg);
        DroneModel.updateStatus(drone.id, {
          status: 'idle',
          task_started_at: null,
          task_eta_at: null,
        });

        logEvent.run('drone_mined', JSON.stringify({
          drone_id: drone.id,
          resource,
          yield_kg: yieldKg,
        }));

        pushToOwner(io, drone.owner_id, 'drone:mined', {
          droneId: drone.id,
          droneName: drone.name,
          resource,
          yieldKg,
        });
      }
    }
  }
}

// ─── Command helpers (called from network layer) ──────────────────────────────

/**
 * Dispatch a drone to travel to a destination.
 * Returns an error string on failure, or null on success.
 */
function dispatchTravel(droneId, destinationId) {
  const drone = DroneModel.findById(droneId);
  if (!drone) return 'Drone not found.';
  if (drone.status !== 'idle') return `Drone is ${drone.status} — cannot dispatch.`;
  if (!world[destinationId]) return `Unknown destination: ${destinationId}`;
  if (drone.location_id === destinationId) return 'Drone is already at that location.';

  const { durationMs, fuelCost } = travelParams(drone.location_id, destinationId, drone.type_id);

  if (drone.fuel_current_l < fuelCost) {
    return `Insufficient fuel. Need ${fuelCost.toFixed(1)}L, have ${drone.fuel_current_l.toFixed(1)}L.`;
  }

  const nowMs = Date.now();
  const etaSec = Math.floor((nowMs + durationMs) / 1000);

  DroneModel.updateStatus(droneId, {
    status: 'travelling',
    destination_id: destinationId,
    task_started_at: Math.floor(nowMs / 1000),
    task_eta_at: etaSec,
    fuel_current_l: parseFloat((drone.fuel_current_l - fuelCost).toFixed(3)),
  });

  return null; // success
}

/**
 * Begin a mining operation at the drone's current location.
 */
function dispatchMine(droneId) {
  const drone = DroneModel.findById(droneId);
  if (!drone) return 'Drone not found.';
  if (drone.status !== 'idle') return `Drone is ${drone.status} — cannot mine.`;

  const spec = DroneModel.spec(drone.type_id);
  if (!spec || spec.mining_power <= 0) return 'This drone type cannot mine.';

  const location = world[drone.location_id];
  if (!location?.resources?.length) return 'No minable resources at this location.';

  const cycleDurationMs = 30_000; // 30-second mining cycle base
  const nowMs = Date.now();

  DroneModel.updateStatus(droneId, {
    status: 'mining',
    task_started_at: Math.floor(nowMs / 1000),
    task_eta_at: Math.floor((nowMs + cycleDurationMs) / 1000),
  });

  return null;
}

// ─── Startup ──────────────────────────────────────────────────────────────────

let tickInterval = null;

function start(io) {
  const intervalMs = economy.physics_tick_interval_ms ?? 10_000;
  log('physics', `Tick engine started — interval ${intervalMs / 1000}s`);
  tickInterval = setInterval(() => tick(io), intervalMs);
  tick(io); // run immediately on startup to resolve any past ETAs
}

function stop() {
  if (tickInterval) clearInterval(tickInterval);
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function pushToOwner(io, ownerId, event, data) {
  if (!io) return;
  io.to(`user:${ownerId}`).emit(event, data);
}

module.exports = { travelParams, distance, dispatchTravel, dispatchMine, start, stop, tick };
