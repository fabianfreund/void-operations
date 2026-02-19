# CLAUDE.md — Void Operations

Working notes for Claude Code on this codebase.

---

## Project Overview

Terminal-based drone MMO. Monorepo with two separate Node.js packages:

- **`/server`** — game server: socket.io, node:sqlite (built-in), bcrypt
- **`/client`** — terminal CLI: socket.io-client, terminal-kit; installable as `void-term`

The server runs a physics tick continuously. The client connects over socket.io and drives a terminal-kit dashboard.

---

## Running the Project

```bash
# Server
cd server && npm install && node index.js

# Client (separate terminal)
cd client && npm install && node bin/void.js

# Docker
mkdir -p data && docker-compose up --build
```

Default server port: `3000`. Client reads `VOID_SERVER` env var (default `http://localhost:3000`).

---

## Architecture

### Data Flow

```
client/bin/void.js
  → client/src/index.js          (app loop)
  → client/src/ui/auth.js        (login/register TUI)
  → client/src/ui/dashboard.js   (menu, progressBar, log)
  → client/src/net/socket.js     (promise-wrapped socket.io-client)
        ↕ socket.io
  server/src/network/socketHandler.js   (all event handlers)
  server/src/systems/physics.js         (tick engine, dispatchers)
  server/src/systems/mining.js          (sell, refuel)
  server/src/models/{user,drone}.js     (DB access layer)
  server/db/init.js                     (better-sqlite3, WAL mode)
```

### Physics Tick

Runs every `economy.json → physics_tick_interval_ms` (default 10 000 ms). Resolves drones whose `task_eta_at` has passed. ETAs are stored as Unix timestamps so the tick is idempotent and works offline. Resolved events are pushed to `user:<id>` socket rooms.

### Auth Handshake

1. Client emits `auth:register` or `auth:login` with `{ username, password }`
2. Server responds `auth:ok` (sanitised user object) or `auth:error { message }`
3. Socket is joined to room `user:<id>` for push notifications

---

## Key Files

| File | Role |
|---|---|
| `server/index.js` | Entry: creates HTTP server, socket.io, starts physics tick |
| `server/db/init.js` | SQLite init — runs schema on every startup (idempotent) |
| `server/src/models/user.js` | User CRUD, bcrypt hash/compare, credit adjustments |
| `server/src/models/drone.js` | Drone CRUD, inventory via `ON CONFLICT` upsert |
| `server/src/systems/physics.js` | `travelParams()`, `dispatchTravel()`, `dispatchMine()`, `tick()`, `start()` |
| `server/src/systems/mining.js` | `sellCargo()` with price volatility, `refuel()` |
| `server/src/network/socketHandler.js` | All socket event handlers; `requireAuth()` guard |
| `client/bin/void.js` | `#!/usr/bin/env node` shebang entry |
| `client/src/index.js` | Event wiring + main menu loop |
| `client/src/net/socket.js` | `SocketManager` — `_request()` wraps emit/once into a Promise |
| `client/src/ui/dashboard.js` | `showMainMenu`, `showDroneSelector`, `renderFleetTable`, `startProgressTracking` |
| `client/src/ui/auth.js` | `runAuthFlow()` — loops until successful auth |

---

## Config Files (the "game math")

All tunable without touching engine code.

| File | Controls |
|---|---|
| `server/config/drones.json` | Per-type: mass, cargo, fuel tank, burn rate, speed, mining power, cost |
| `server/config/world.json` | Locations: coordinates (x/y), resources, services (market/refuel/repair), richness, danger |
| `server/config/economy.json` | Resource prices + volatility, fuel price, market tax rate, tick interval |

**Adding a drone type:** add a key to `drones.json`. The type ID is stored in the `drones` table and looked up at tick time.

**Adding a world location:** add a key to `world.json`, then mirror it in `client/src/world.js` (the client keeps a local copy for the location selector UI).

---

## Database Schema

SQLite at `server/db/void.db`. WAL mode enabled. Foreign keys on.

```sql
users       (id, username, password, credits, created_at, last_seen)
drones      (id, owner_id, type_id, name, status, fuel_current_l,
             location_id, destination_id, task_started_at, task_eta_at, created_at)
inventory   (id, drone_id, resource_id, quantity_kg)  -- UNIQUE(drone_id, resource_id)
event_log   (id, event_type, payload JSON, created_at)
```

`status` values: `idle` | `travelling` | `mining` | `returning`

Inventory uses `INSERT ... ON CONFLICT DO UPDATE` so quantities accumulate correctly.

---

## Socket Events Reference

### Client → Server

| Event | Auth required | Payload |
|---|---|---|
| `auth:register` | No | `{ username, password }` |
| `auth:login` | No | `{ username, password }` |
| `fleet:list` | Yes | — |
| `fleet:drone` | Yes | `{ droneId }` |
| `cmd:travel` | Yes | `{ droneId, destination }` |
| `cmd:mine` | Yes | `{ droneId }` |
| `cmd:sell` | Yes | `{ droneId }` |
| `cmd:refuel` | Yes | `{ droneId, litres? }` |

### Server → Client (push)

| Event | Trigger |
|---|---|
| `auth:ok` | Successful login/register |
| `auth:error` | Failed auth |
| `fleet:list` | Response to `fleet:list` |
| `fleet:drone` | Response to `fleet:drone` |
| `cmd:ok` | Command accepted |
| `cmd:error` | Command rejected |
| `drone:arrived` | Physics tick resolves travel |
| `drone:mined` | Physics tick resolves mining |
| `error` | General server error |

---

## Conventions

- **`'use strict'`** at the top of every server and client file.
- Server modules use synchronous `better-sqlite3` (no async/await in DB layer).
- `socket.js` on the client uses `_request()` to wrap every emit/once pair into a Promise with a 10-second timeout.
- `requireAuth()` in `socketHandler.js` is a closure guard — wrap any handler that needs a logged-in user with it.
- `enrichDrone()` in `socketHandler.js` attaches `spec`, `inventory`, `eta_ms`, and `progress_pct` to drone objects before sending to clients. Always use this when returning drone data.
- The physics tick runs `tick()` once immediately on `start()` to resolve any ETAs that elapsed while the server was offline.

---

## Common Tasks

**Add a new socket command**
1. Add handler in `socketHandler.js` inside `registerHandlers()`, wrapped with `requireAuth()`
2. Add the corresponding method in `client/src/net/socket.js` using `_request()`
3. Wire up to a menu option in `client/src/index.js`

**Add a new drone status**
1. Add the status string to `drones` table docs in `db/init.js` (schema comment)
2. Handle it in `physics.js` `tick()` function
3. Add a color mapping in `dashboard.js` `renderFleetTable()` (`statusColor` object)

**Change the tick interval**
Edit `server/config/economy.json → physics_tick_interval_ms`. The server must restart to pick up the change.

**Run a database query manually**
```bash
sqlite3 server/db/void.db "SELECT name, status, fuel_current_l FROM drones;"
```

---

## Docker Notes

- `Dockerfile` builds from `server/` only (Alpine + python3/make/g++ for native `better-sqlite3`)
- `docker-compose.yml` mounts `./data/` → `/app/db/` — the SQLite file lives at `./data/void.db`
- Health check hits `GET /health` — returns `{ status: "ok", uptime }` — used by compose and Docker restart logic
- The client is not containerised; run it locally and point `VOID_SERVER` at the container
