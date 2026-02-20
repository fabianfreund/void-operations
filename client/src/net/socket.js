'use strict';

/**
 * Client Socket Manager
 *
 * Wraps socket.io-client with:
 *   - Automatic reconnection
 *   - Promise-based auth handshake
 *   - Event emitter passthrough for the UI layer
 */

const { io } = require('socket.io-client');
const { EventEmitter } = require('events');

class SocketManager extends EventEmitter {
  constructor() {
    super();
    this.socket = null;
    this.user = null;
  }

  connect(serverUrl = 'http://localhost:3000') {
    this.socket = io(serverUrl, {
      autoConnect: true,
      reconnection: true,
      reconnectionDelay: 2000,
      reconnectionAttempts: Infinity,
    });

    this.socket.on('connect', () => {
      this.emit('connected');
    });

    this.socket.on('disconnect', (reason) => {
      this.emit('disconnected', reason);
    });

    this.socket.on('connect_error', (err) => {
      this.emit('connect_error', err.message);
    });

    // Physics / async events pushed by the server
    this.socket.on('drone:arrived', (data) => this.emit('drone:arrived', data));
    this.socket.on('drone:mined', (data) => this.emit('drone:mined', data));
    this.socket.on('drone:offline', (data) => this.emit('drone:offline', data));
    this.socket.on('drone:emergency', (data) => this.emit('drone:emergency', data));
    this.socket.on('error', (data) => this.emit('server:error', data));
  }

  // ── Auth ────────────────────────────────────────────────────────────────

  register(username, password) {
    return this._request('auth:register', { username, password }, 'auth:ok', 'auth:error');
  }

  login(username, password) {
    return this._request('auth:login', { username, password }, 'auth:ok', 'auth:error');
  }

  // ── Fleet ────────────────────────────────────────────────────────────────

  listFleet() {
    return this._request('fleet:list', null, 'fleet:list');
  }

  getDrone(droneId) {
    return this._request('fleet:drone', { droneId }, 'fleet:drone');
  }

  scanNearby(droneId) {
    return this._request('fleet:scan', { droneId }, 'fleet:scan', 'fleet:error');
  }

  // ── Commands ─────────────────────────────────────────────────────────────

  travel(droneId, destination) {
    return this._request('cmd:travel', { droneId, destination }, 'cmd:ok', 'cmd:error');
  }

  mine(droneId) {
    return this._request('cmd:mine', { droneId }, 'cmd:ok', 'cmd:error');
  }

  sell(droneId) {
    return this._request('cmd:sell', { droneId }, 'cmd:ok', 'cmd:error');
  }

  refuel(droneId, litres) {
    return this._request('cmd:refuel', { droneId, litres }, 'cmd:ok', 'cmd:error');
  }

  stopInPlace(droneId) {
    return this._request('cmd:stop', { droneId }, 'cmd:ok', 'cmd:error');
  }

  renameDrone(droneId, name) {
    return this._request('cmd:rename', { droneId, name }, 'cmd:ok', 'cmd:error');
  }

  // ── Administration ─────────────────────────────────────────────────────

  setOrganization(name) {
    return this._request('org:set', { name }, 'org:ok', 'org:error');
  }

  listOrganizations() {
    return this._request('org:list', null, 'org:list');
  }

  listPlayers() {
    return this._request('players:list', null, 'players:list');
  }

  resetPlayer(playerId) {
    return this._request('players:reset', { playerId }, 'players:reset', 'players:error');
  }

  // ── Internal ─────────────────────────────────────────────────────────────

  /**
   * Emit an event and wait for a success or error response.
   */
  _request(event, data, successEvent, errorEvent = null, timeoutMs = 10_000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Request timed out: ${event}`));
      }, timeoutMs);

      const onSuccess = (payload) => {
        cleanup();
        this.user = payload?.id ? payload : this.user; // cache user on auth:ok
        resolve(payload);
      };

      const onError = (payload) => {
        cleanup();
        reject(new Error(payload?.message ?? 'Unknown server error'));
      };

      const cleanup = () => {
        clearTimeout(timer);
        this.socket.off(successEvent, onSuccess);
        if (errorEvent) this.socket.off(errorEvent, onError);
      };

      this.socket.once(successEvent, onSuccess);
      if (errorEvent) this.socket.once(errorEvent, onError);

      if (data !== null) {
        this.socket.emit(event, data);
      } else {
        this.socket.emit(event);
      }
    });
  }
}

module.exports = new SocketManager();
