'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_DIR = path.join(__dirname);
const DB_PATH = path.join(DB_DIR, 'void.db');

if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const SCHEMA = `
  -- Users / accounts
  CREATE TABLE IF NOT EXISTS users (
    id          TEXT PRIMARY KEY,
    username    TEXT UNIQUE NOT NULL,
    password    TEXT NOT NULL,
    credits     REAL NOT NULL DEFAULT 5000,
    created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
    last_seen   INTEGER NOT NULL DEFAULT (unixepoch())
  );

  -- Drone instances owned by users
  CREATE TABLE IF NOT EXISTS drones (
    id              TEXT PRIMARY KEY,
    owner_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type_id         TEXT NOT NULL,
    name            TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'idle',
    fuel_current_l  REAL NOT NULL DEFAULT 0,
    battery_remaining_sec INTEGER,
    coord_x         REAL,
    coord_y         REAL,
    location_id     TEXT NOT NULL DEFAULT 'hub',
    destination_id  TEXT,
    task_origin_x   REAL,
    task_origin_y   REAL,
    task_started_at INTEGER,
    task_eta_at     INTEGER,
    created_at      INTEGER NOT NULL DEFAULT (unixepoch())
  );

  -- Cargo / inventory per drone
  CREATE TABLE IF NOT EXISTS inventory (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    drone_id    TEXT NOT NULL REFERENCES drones(id) ON DELETE CASCADE,
    resource_id TEXT NOT NULL,
    quantity_kg REAL NOT NULL DEFAULT 0,
    UNIQUE(drone_id, resource_id)
  );

  -- System event log
  CREATE TABLE IF NOT EXISTS event_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type  TEXT NOT NULL,
    payload     TEXT,
    created_at  INTEGER NOT NULL DEFAULT (unixepoch())
  );
`;

db.exec(SCHEMA);

// ── Lightweight migrations ────────────────────────────────────────────────

const userColumns = db.prepare('PRAGMA table_info(users)').all();
const hasOrgName = userColumns.some((c) => c.name === 'org_name');
if (!hasOrgName) {
  db.exec('ALTER TABLE users ADD COLUMN org_name TEXT');
}
db.exec('CREATE INDEX IF NOT EXISTS idx_users_org_name ON users(org_name)');

const droneColumns = db.prepare('PRAGMA table_info(drones)').all();
const hasBatteryRemainingSec = droneColumns.some((c) => c.name === 'battery_remaining_sec');
if (!hasBatteryRemainingSec) {
  db.exec('ALTER TABLE drones ADD COLUMN battery_remaining_sec INTEGER');
}
const hasCoordX = droneColumns.some((c) => c.name === 'coord_x');
if (!hasCoordX) {
  db.exec('ALTER TABLE drones ADD COLUMN coord_x REAL');
}
const hasCoordY = droneColumns.some((c) => c.name === 'coord_y');
if (!hasCoordY) {
  db.exec('ALTER TABLE drones ADD COLUMN coord_y REAL');
}
const hasTaskOriginX = droneColumns.some((c) => c.name === 'task_origin_x');
if (!hasTaskOriginX) {
  db.exec('ALTER TABLE drones ADD COLUMN task_origin_x REAL');
}
const hasTaskOriginY = droneColumns.some((c) => c.name === 'task_origin_y');
if (!hasTaskOriginY) {
  db.exec('ALTER TABLE drones ADD COLUMN task_origin_y REAL');
}

// Use process.stdout directly — serverConsole may not be ready yet at DB init time
process.stdout.write(`\x1b[90m[DB] Database ready at ${DB_PATH}\x1b[0m\n`);

module.exports = db;
