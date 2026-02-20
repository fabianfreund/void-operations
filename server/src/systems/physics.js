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
  const a = locationCoords(locA);
  const b = locationCoords(locB);
  if (!a || !b) throw new Error(`Unknown location: ${locA} or ${locB}`);
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function distanceCoords(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function locationCoords(locationId) {
  const loc = world[locationId];
  if (!loc?.coordinates) return null;
  return { x: loc.coordinates.x, y: loc.coordinates.y };
}

function hasNumericCoords(obj) {
  return Number.isFinite(obj?.x) && Number.isFinite(obj?.y);
}

function droneCoords(drone) {
  if (Number.isFinite(drone?.coord_x) && Number.isFinite(drone?.coord_y)) {
    return { x: drone.coord_x, y: drone.coord_y };
  }
  return locationCoords(drone?.location_id) ?? { x: 0, y: 0 };
}

function positionAlong(from, to, ratio) {
  const t = Math.min(1, Math.max(0, ratio));
  return {
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
  };
}

/**
 * Calculate travel parameters between two world locations.
 * @param {string} fromId  - world location key
 * @param {string} toId    - world location key
 * @param {string} typeId  - drone spec key
 * @returns {{ distanceKm: number, durationMs: number, fuelCost: number }}
 */
function travelParams(fromId, toId, typeId) {
  const from = locationCoords(fromId);
  const to = locationCoords(toId);
  if (!from || !to) throw new Error(`Unknown location: ${fromId} or ${toId}`);
  return travelParamsFromCoords(from, to, typeId);
}

function travelParamsFromCoords(from, to, typeId) {
  const spec = droneSpecs[typeId];
  if (!spec) throw new Error(`Unknown drone type: ${typeId}`);

  const distanceKm = distanceCoords(from, to);
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
      const destination = locationCoords(drone.destination_id);
      if (!destination) continue;
      const origin = hasNumericCoords({ x: drone.task_origin_x, y: drone.task_origin_y })
        ? { x: drone.task_origin_x, y: drone.task_origin_y }
        : droneCoords(drone);
      const { durationMs } = travelParamsFromCoords(origin, destination, drone.type_id);
      const fullEtaSec = drone.task_started_at + Math.floor(durationMs / 1000);

      // Ran out of fuel before arrival, now running emergency battery.
      if (drone.task_eta_at < fullEtaSec) {
        const emergencySec = DroneModel.spec(drone.type_id)?.battery_capacity_sec ?? 0;
        const startedAt = nowSec;
        const emergencyEta = startedAt + emergencySec;
        const travelTotalSec = Math.max(1, fullEtaSec - drone.task_started_at);
        const runoutRatio = (drone.task_eta_at - drone.task_started_at) / travelTotalSec;
        const runoutPos = positionAlong(origin, destination, runoutRatio);

        DroneModel.updateStatus(drone.id, {
          status: 'emergency',
          location_id: 'deep_space',
          destination_id: drone.destination_id,
          coord_x: parseFloat(runoutPos.x.toFixed(3)),
          coord_y: parseFloat(runoutPos.y.toFixed(3)),
          task_started_at: startedAt,
          task_eta_at: emergencyEta,
          task_origin_x: null,
          task_origin_y: null,
          battery_remaining_sec: emergencySec,
        });

        logEvent.run('drone_emergency', JSON.stringify({
          drone_id: drone.id,
          location: drone.location_id,
          destination: drone.destination_id,
          battery_sec: emergencySec,
        }));

        pushToOwner(io, drone.owner_id, 'drone:emergency', {
          droneId: drone.id,
          droneName: drone.name,
          location: drone.location_id,
          destination: drone.destination_id,
          batterySec: emergencySec,
        });
      } else {
        DroneModel.updateStatus(drone.id, {
          status: 'idle',
          location_id: drone.destination_id,
          coord_x: destination.x,
          coord_y: destination.y,
          destination_id: null,
          task_started_at: null,
          task_eta_at: null,
          task_origin_x: null,
          task_origin_y: null,
          battery_remaining_sec: null,
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
          battery_remaining_sec: null,
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

    if (drone.status === 'emergency') {
      DroneModel.updateStatus(drone.id, {
        status: 'offline',
        task_started_at: null,
        task_eta_at: null,
        task_origin_x: null,
        task_origin_y: null,
        battery_remaining_sec: 0,
      });

      logEvent.run('drone_offline', JSON.stringify({
        drone_id: drone.id,
        location: drone.location_id,
        destination: drone.destination_id,
      }));

      pushToOwner(io, drone.owner_id, 'drone:offline', {
        droneId: drone.id,
        droneName: drone.name,
        location: drone.location_id,
        destination: drone.destination_id,
      });
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
  const destination = locationCoords(destinationId);
  if (!destination) return `Unknown destination: ${destinationId}`;

  const from = droneCoords(drone);
  if (drone.location_id === destinationId && distanceCoords(from, destination) < 0.001) {
    return 'Drone is already at that location.';
  }

  const { durationMs, fuelCost } = travelParamsFromCoords(from, destination, drone.type_id);

  const nowMs = Date.now();
  const startedAtSec = Math.floor(nowMs / 1000);
  const fullEtaSec = Math.max(startedAtSec + 1, Math.floor((nowMs + durationMs) / 1000));

  let etaSec = fullEtaSec;
  let newFuel = drone.fuel_current_l - fuelCost;
  if (newFuel < 0) {
    const fuelRatio = Math.max(0, drone.fuel_current_l / fuelCost);
    const runoutMs = Math.floor(durationMs * fuelRatio);
    etaSec = Math.max(startedAtSec + 1, Math.floor((nowMs + runoutMs) / 1000));
    newFuel = 0;
  }

  DroneModel.updateStatus(droneId, {
    status: 'travelling',
    destination_id: destinationId,
    task_started_at: startedAtSec,
    task_eta_at: etaSec,
    task_origin_x: parseFloat(from.x.toFixed(3)),
    task_origin_y: parseFloat(from.y.toFixed(3)),
    fuel_current_l: parseFloat(newFuel.toFixed(3)),
    battery_remaining_sec: null,
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
    battery_remaining_sec: null,
  });

  return null;
}

/**
 * Abort active travel/emergency and keep the drone at its current location.
 * Returns an error string on failure, or null on success.
 */
function stopInPlace(droneId) {
  const drone = DroneModel.findById(droneId);
  if (!drone) return 'Drone not found.';
  if (drone.status !== 'travelling' && drone.status !== 'emergency') {
    return `Drone is ${drone.status} — cannot stop in place.`;
  }

  let pos = droneCoords(drone);
  if (drone.status === 'travelling') {
    const destination = locationCoords(drone.destination_id);
    const origin = hasNumericCoords({ x: drone.task_origin_x, y: drone.task_origin_y })
      ? { x: drone.task_origin_x, y: drone.task_origin_y }
      : droneCoords(drone);
    if (destination && drone.task_started_at && drone.task_eta_at) {
      const { durationMs } = travelParamsFromCoords(origin, destination, drone.type_id);
      const fullTravelSec = Math.max(1, Math.floor(durationMs / 1000));
      const elapsedSec = Math.max(0, Math.floor(Date.now() / 1000) - drone.task_started_at);
      const ratio = elapsedSec / fullTravelSec;
      pos = positionAlong(origin, destination, ratio);
    }
  }

  DroneModel.updateStatus(droneId, {
    status: 'idle',
    location_id: 'deep_space',
    coord_x: parseFloat(pos.x.toFixed(3)),
    coord_y: parseFloat(pos.y.toFixed(3)),
    destination_id: null,
    task_started_at: null,
    task_eta_at: null,
    task_origin_x: null,
    task_origin_y: null,
    battery_remaining_sec: null,
  });

  return null;
}

// ─── Startup ──────────────────────────────────────────────────────────────────

let tickInterval = null;
let tickIntervalMs = economy.physics_tick_interval_ms ?? 10_000;

function scheduleTick(io) {
  if (tickInterval) clearInterval(tickInterval);
  tickInterval = setInterval(() => tick(io), tickIntervalMs);
}

function start(io) {
  log('physics', `Tick engine started — interval ${tickIntervalMs / 1000}s`);
  scheduleTick(io);
  tick(io); // run immediately on startup to resolve any past ETAs
}

function stop() {
  if (tickInterval) clearInterval(tickInterval);
  tickInterval = null;
}

function getTickIntervalMs() {
  return tickIntervalMs;
}

function setTickIntervalMs(io, intervalMs) {
  tickIntervalMs = intervalMs;
  if (tickInterval) scheduleTick(io);
  return tickIntervalMs;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function pushToOwner(io, ownerId, event, data) {
  if (!io) return;
  io.to(`user:${ownerId}`).emit(event, data);
}

module.exports = {
  travelParams,
  distance,
  dispatchTravel,
  dispatchMine,
  stopInPlace,
  start,
  stop,
  tick,
  getTickIntervalMs,
  setTickIntervalMs,
};
