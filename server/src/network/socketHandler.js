'use strict';

/**
 * Socket.IO Connection Handler
 *
 * Handshake flow:
 *   1. Client emits  `auth:register` or `auth:login` with { username, password }
 *   2. Server replies `auth:ok` with user profile, or `auth:error` with reason
 *   3. Successful auth puts the socket in a private room: `user:<id>`
 *   4. All further game commands are sent after auth is established
 */

const UserModel = require('../models/user');
const DroneModel = require('../models/drone');
const Physics = require('../systems/physics');
const Mining = require('../systems/mining');
const { log } = require('../ui/console');
const world = require('../../config/world.json');
const economy = require('../../config/economy.json');
const db = require('../../db/init');

function registerHandlers(io, socket) {
  let authedUser = null;

  // ── Helper ────────────────────────────────────────────────────────────────

  function requireAuth(fn) {
    return (...args) => {
      if (!authedUser) {
        socket.emit('error', { message: 'Not authenticated.' });
        return;
      }
      fn(...args);
    };
  }

  function ack(event, data) {
    socket.emit(event, data);
  }

  function droneCoordinates(drone) {
    if (Number.isFinite(drone?.coord_x) && Number.isFinite(drone?.coord_y)) {
      return { x: drone.coord_x, y: drone.coord_y };
    }
    const loc = world[drone?.location_id];
    if (loc?.coordinates) return loc.coordinates;
    return { x: 0, y: 0 };
  }

  // ── Auth ──────────────────────────────────────────────────────────────────

  socket.on('auth:register', ({ username, password } = {}) => {
    if (!username || !password) {
      return ack('auth:error', { message: 'Username and password required.' });
    }
    if (username.length < 3 || username.length > 24) {
      return ack('auth:error', { message: 'Username must be 3–24 characters.' });
    }
    if (password.length < 6) {
      return ack('auth:error', { message: 'Password must be at least 6 characters.' });
    }

    const existing = UserModel.findByUsername(username);
    if (existing) {
      return ack('auth:error', { message: 'Username already taken.' });
    }

    try {
      const user = UserModel.create(username, password);
      authedUser = user;
      socket.join(`user:${user.id}`);

      // New players start with a Scout drone
      DroneModel.create(user.id, 'scout', `${username}'s Scout`);

      log('ok', `New user registered: ${username} (${user.id})`);
      ack('auth:ok', sanitizeUser(user));
    } catch (err) {
      console.error('[Auth] Registration error:', err);
      ack('auth:error', { message: 'Registration failed. Please try again.' });
    }
  });

  socket.on('auth:login', ({ username, password } = {}) => {
    if (!username || !password) {
      return ack('auth:error', { message: 'Username and password required.' });
    }

    const user = UserModel.findByUsername(username);
    if (!user || !UserModel.verifyPassword(user, password)) {
      return ack('auth:error', { message: 'Invalid credentials.' });
    }

    authedUser = user;
    UserModel.updateLastSeen(user.id);
    socket.join(`user:${user.id}`);

    log('ok', `User logged in: ${username}`);
    ack('auth:ok', sanitizeUser(user));
  });

  // ── Fleet ─────────────────────────────────────────────────────────────────

  socket.on('fleet:list', requireAuth(() => {
    const drones = DroneModel.findByOwner(authedUser.id).map(enrichDrone);
    ack('fleet:list', drones);
  }));

  socket.on('fleet:drone', requireAuth(({ droneId } = {}) => {
    const drone = DroneModel.findById(droneId);
    if (!drone || drone.owner_id !== authedUser.id) {
      return ack('error', { message: 'Drone not found.' });
    }
    ack('fleet:drone', enrichDrone(drone));
  }));

  socket.on('fleet:scan', requireAuth(({ droneId } = {}) => {
    const drone = DroneModel.findById(droneId);
    if (!drone || drone.owner_id !== authedUser.id) {
      return ack('fleet:error', { message: 'Drone not found.' });
    }
    if (drone.status !== 'idle' && drone.status !== 'emergency') {
      return ack('fleet:error', { message: 'Drone must be idle or emergency to scan.' });
    }

    const origin = world[drone.location_id];
    const originCoords = droneCoordinates(drone);
    const SCAN_RANGE = 250;
    const nearby = Object.values(world)
      .filter((loc) => loc.id !== drone.location_id)
      .map((loc) => {
        const dx = (loc.coordinates?.x ?? 0) - originCoords.x;
        const dy = (loc.coordinates?.y ?? 0) - originCoords.y;
        const distance = Math.round(Math.sqrt(dx * dx + dy * dy));
        return { ...loc, distance };
      })
      .filter((loc) => loc.distance <= SCAN_RANGE)
      .sort((a, b) => a.distance - b.distance);

    const rows = db.prepare(`
      SELECT d.id, d.name, d.type_id, d.status, d.location_id,
             u.username AS owner_username, u.org_name AS owner_org
      FROM drones d
      JOIN users u ON u.id = d.owner_id
      WHERE d.location_id = ? AND d.id != ?
      ORDER BY d.status, d.name
    `).all(drone.location_id, drone.id);

    ack('fleet:scan', {
      location: origin
        ? drone.location_id
        : `deep_space (${originCoords.x.toFixed(1)}, ${originCoords.y.toFixed(1)})`,
      location_info: origin ?? {
        id: 'deep_space',
        name: 'Deep Space Position',
        type: 'deep_space',
        description: `Open-space position at (${originCoords.x.toFixed(1)}, ${originCoords.y.toFixed(1)}).`,
        coordinates: originCoords,
      },
      ships: rows,
      nearby,
    });
  }));

  // ── Commands ──────────────────────────────────────────────────────────────

  socket.on('cmd:travel', requireAuth(({ droneId, destination } = {}) => {
    const drone = DroneModel.findById(droneId);
    if (!drone || drone.owner_id !== authedUser.id) {
      return ack('cmd:error', { message: 'Drone not found.' });
    }

    const err = Physics.dispatchTravel(droneId, destination);
    if (err) return ack('cmd:error', { message: err });

    const updated = DroneModel.findById(droneId);
    ack('cmd:ok', { action: 'travel', drone: enrichDrone(updated) });
  }));

  socket.on('cmd:mine', requireAuth(({ droneId } = {}) => {
    const drone = DroneModel.findById(droneId);
    if (!drone || drone.owner_id !== authedUser.id) {
      return ack('cmd:error', { message: 'Drone not found.' });
    }

    const result = Mining.startMining(droneId);
    if (!result.ok) return ack('cmd:error', { message: result.error });

    const updated = DroneModel.findById(droneId);
    ack('cmd:ok', { action: 'mine', drone: enrichDrone(updated) });
  }));

  socket.on('cmd:sell', requireAuth(({ droneId } = {}) => {
    const drone = DroneModel.findById(droneId);
    if (!drone || drone.owner_id !== authedUser.id) {
      return ack('cmd:error', { message: 'Drone not found.' });
    }

    const result = Mining.sellCargo(droneId);
    if (!result.ok) return ack('cmd:error', { message: result.error });

    ack('cmd:ok', { action: 'sell', ...result });
  }));

  socket.on('cmd:refuel', requireAuth(({ droneId, litres = 999 } = {}) => {
    const drone = DroneModel.findById(droneId);
    if (!drone || drone.owner_id !== authedUser.id) {
      return ack('cmd:error', { message: 'Drone not found.' });
    }

    const result = Mining.refuel(droneId, litres);
    if (!result.ok) return ack('cmd:error', { message: result.error });

    ack('cmd:ok', { action: 'refuel', ...result });
  }));

  socket.on('cmd:stop', requireAuth(({ droneId } = {}) => {
    const drone = DroneModel.findById(droneId);
    if (!drone || drone.owner_id !== authedUser.id) {
      return ack('cmd:error', { message: 'Drone not found.' });
    }

    const err = Physics.stopInPlace(droneId);
    if (err) return ack('cmd:error', { message: err });

    const updated = DroneModel.findById(droneId);
    ack('cmd:ok', { action: 'stop', drone: enrichDrone(updated) });
  }));

  socket.on('cmd:rename', requireAuth(({ droneId, name } = {}) => {
    const drone = DroneModel.findById(droneId);
    if (!drone || drone.owner_id !== authedUser.id) {
      return ack('cmd:error', { message: 'Drone not found.' });
    }

    const nextName = String(name ?? '').trim();
    if (nextName.length < 3 || nextName.length > 32) {
      return ack('cmd:error', { message: 'Drone name must be 3–32 characters.' });
    }

    const updated = DroneModel.rename(droneId, nextName);
    ack('cmd:ok', { action: 'rename', drone: enrichDrone(updated) });
  }));

  // ── Administration ─────────────────────────────────────────────────────

  socket.on('org:set', requireAuth(({ name } = {}) => {
    const orgName = String(name ?? '').trim();
    if (orgName.length < 3 || orgName.length > 32) {
      return ack('org:error', { message: 'Organization name must be 3–32 characters.' });
    }

    const existing = UserModel.findByOrgName(orgName);
    if (existing && existing.id !== authedUser.id) {
      return ack('org:error', { message: 'Organization already exists.' });
    }

    const updated = UserModel.updateOrgName(authedUser.id, orgName);
    authedUser = updated;
    ack('org:ok', sanitizeUser(updated));
  }));

  socket.on('org:list', requireAuth(() => {
    const orgs = UserModel.listOrganizations();
    ack('org:list', orgs);
  }));

  socket.on('players:list', requireAuth(() => {
    const players = UserModel.listPlayers();
    ack('players:list', players);
  }));

  socket.on('players:reset', requireAuth(({ playerId } = {}) => {
    if (!playerId) {
      return ack('players:error', { message: 'playerId is required.' });
    }

    const target = UserModel.findById(playerId);
    if (!target) {
      return ack('players:error', { message: 'Player not found.' });
    }

    const resetPlayer = db.transaction(() => {
      db.prepare('DELETE FROM drones WHERE owner_id = ?').run(playerId);
      db.prepare('UPDATE users SET credits = ?, org_name = NULL WHERE id = ?')
        .run(economy.starting_balance, playerId);
      DroneModel.create(playerId, 'scout', `${target.username}'s Scout`);
    });

    resetPlayer();

    const updated = UserModel.findById(playerId);
    if (updated.id === authedUser.id) authedUser = updated;
    log('warn', `Player reset: ${updated.username} (${updated.id})`);
    ack('players:reset', { player: sanitizeUser(updated) });
  }));

  // ── Disconnect ────────────────────────────────────────────────────────────

  socket.on('disconnect', () => {
    if (authedUser) {
      UserModel.updateLastSeen(authedUser.id);
      log('socket', `${authedUser.username} disconnected`);
    }
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sanitizeUser(user) {
  const { password, ...safe } = user;
  return safe;
}

function enrichDrone(drone) {
  const spec = DroneModel.spec(drone.type_id);
  const inventory = DroneModel.getInventory(drone.id);
  const etaMs = drone.task_eta_at ? drone.task_eta_at * 1000 : null;
  const progressPct = calcProgress(drone);
  const emergencyBatterySec =
    drone.status === 'emergency' && drone.task_eta_at
      ? Math.max(0, drone.task_eta_at - Math.floor(Date.now() / 1000))
      : drone.battery_remaining_sec;

  return {
    ...drone,
    spec,
    inventory,
    battery_remaining_sec: emergencyBatterySec,
    eta_ms: etaMs,
    progress_pct: progressPct,
  };
}

function calcProgress(drone) {
  if (!drone.task_started_at || !drone.task_eta_at) return null;
  const nowSec = Math.floor(Date.now() / 1000);
  const total = drone.task_eta_at - drone.task_started_at;
  const elapsed = nowSec - drone.task_started_at;
  return Math.min(100, Math.max(0, Math.round((elapsed / total) * 100)));
}

module.exports = { registerHandlers };
