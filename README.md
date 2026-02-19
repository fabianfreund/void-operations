# VOID OPERATIONS

A terminal-based drone MMO with deep simulation systems. Command a fleet of drones across a persistent universe — mine asteroids, haul cargo, and grow your operation while the server ticks forward even when you're offline.

```
╔══════════════════════════════╗
║   VOID OPERATIONS v0.1.0     ║
╚══════════════════════════════╝

  COMMAND DECK

  ▸ View Fleet
    Travel
    Mine
    Sell Cargo
    Refuel
    Refresh Status
    Quit

  ── SYSTEM LOG ──
  [12:04:01] Drone "Alpha Scout" arrived at Kessler Belt — Sector A
  [12:03:45] Miner Mk.I started mining at asteroid_belt_a
```

---

## Features

- **Offline simulation** — drones complete missions while you're disconnected. The physics tick runs server-side every 10 seconds and resolves travel and mining tasks against real timestamps.
- **Persistent world** — SQLite database stores user accounts, drone fleets, inventory, and the event log. Survives server restarts via Docker volume.
- **JSON-first design** — all game math lives in `server/config/`. Tweak drone specs, fuel prices, resource values, and world locations without touching engine code.
- **Terminal-kit UI** — a clean dashboard with a navigation menu, real-time progress bar for active drone tasks, and a scrolling system log.
- **Monorepo** — server and client have separate `package.json` files and dependency trees. The client ships as a globally-installable CLI (`void-term`).

---

## Requirements

- Node.js 20+
- npm 9+
- Docker & Docker Compose (optional, for containerised server)

---

## Quick Start — Local Development

**1. Install dependencies**

```bash
cd server && npm install
cd ../client && npm install
```

**2. Run the server**

```bash
node server/index.js
```

The server starts on port `3000` by default. On first launch it creates `server/db/void.db` with the full schema.

**3. Run the client** (in a second terminal)

```bash
node client/bin/void.js
```

Or install globally and use the `void-term` command:

```bash
cd client && npm install -g .
void-term
```

**Environment variable**

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Server listen port |
| `VOID_SERVER` | `http://localhost:3000` | Server URL used by the client |
| `PUBLIC_URL` | — | Base URL used for `/client/install` responses (useful behind a proxy) |

---

## Docker Deployment

The `Dockerfile` builds the server into an Alpine image. SQLite data is persisted via a local volume mount.

```bash
# Create the data directory (persists your universe)
mkdir -p data

# Build and start
docker-compose up --build

# Run in background
docker-compose up -d --build

# View logs
docker-compose logs -f server
```

The server is reachable at `http://localhost:3000`. Connect the client with:

```bash
VOID_SERVER=http://localhost:3000 void-term
```

### Download the client from the server

The server hosts a ready-to-install client tarball. From any machine with Node.js + npm:

```bash
curl -fsSL https://dibe-void-operations.tvpcm4.easypanel.host//client/install | sh
```

This writes `~/.void-ops/client.json` with the correct server URL and installs the `void-term` CLI globally. You can then run:

```bash
void-term
```

If you're running the server outside Docker, generate the tarball first:

```bash
npm run build:client-tarball
```

### Build-time server URL (optional)

If you want the baked-in default server URL inside the client package during image build:

```bash
docker build --build-arg VOID_SERVER_URL=http://SERVER:3000 -t void-operations .
```

For reverse proxies or HTTPS, set `PUBLIC_URL` on the server so the install script returns the correct URL.

---

## Project Structure

```
void-operations/
├── Dockerfile
├── docker-compose.yml
├── package.json              ← root (npm workspaces)
│
├── server/
│   ├── index.js              ← entry point
│   ├── config/
│   │   ├── drones.json       ← drone specs (mass, speed, fuel rate, mining power)
│   │   ├── world.json        ← locations with coordinates and services
│   │   └── economy.json      ← resource prices, fuel cost, tick interval
│   ├── db/
│   │   └── init.js           ← SQLite schema initialisation
│   └── src/
│       ├── models/
│       │   ├── user.js       ← account creation, bcrypt auth, credit management
│       │   └── drone.js      ← fleet CRUD, inventory management
│       ├── systems/
│       │   ├── physics.js    ← offline tick engine, travel & mine dispatch
│       │   └── mining.js     ← sell cargo (with market tax), refuel
│       └── network/
│           └── socketHandler.js  ← socket.io event handlers + auth handshake
│
└── client/
    ├── bin/void.js           ← CLI entry point (void-term)
    └── src/
        ├── index.js          ← main application loop
        ├── world.js          ← client-side location map
        ├── net/socket.js     ← promise-wrapped socket.io-client
        └── ui/
            ├── auth.js       ← login / register TUI
            └── dashboard.js  ← menu, progress bar, system log
```

---

## Game Systems

### Drone Fleet

New accounts start with a Scout drone and 5,000 VOIDcredits.

| Drone | Speed | Cargo | Fuel Tank | Burn Rate | Mining Power | Cost |
|---|---|---|---|---|---|---|
| Scout | 120 km/h | 5 kg | 20 L | 0.15 L/km | — | 500 cr |
| Miner Mk.I | 40 km/h | 80 kg | 60 L | 0.55 L/km | 10 | 2,000 cr |
| Miner Mk.II | 35 km/h | 150 kg | 100 L | 0.80 L/km | 25 | 6,500 cr |
| Heavy Hauler | 20 km/h | 500 kg | 150 L | 1.40 L/km | — | 12,000 cr |

Travel time and fuel cost are calculated from real Euclidean distance between location coordinates.

### World Locations

| Location | Type | Services | Resources |
|---|---|---|---|
| Orbital Hub Alpha | Station | Market, Refuel, Repair | — |
| Kessler Belt — Sector A | Mining Zone | — | Iron, Nickel |
| Kessler Belt — Sector B | Mining Zone | — | Silicate, Titanium |
| Deep Void Outpost | Outpost | Market, Refuel | — |

### Economy

Resources have a base price with random volatility applied at the point of sale. A 3% market tax is deducted from all sales. Fuel costs 1.2 VOIDcredits per litre.

| Resource | Base Price | Volatility |
|---|---|---|
| Iron Ore | 8 cr/kg | ±5% |
| Nickel Ore | 14 cr/kg | ±8% |
| Silicate Crystal | 22 cr/kg | ±12% |
| Titanium Shard | 65 cr/kg | ±18% |

### Physics Tick

The server runs a tick every 10 seconds (configurable via `economy.json → physics_tick_interval_ms`). On each tick it:

1. Queries all non-idle drones across all users
2. Checks each drone's `task_eta_at` timestamp against the current time
3. Resolves completed tasks (arrival or mining yield) and updates the database
4. Pushes real-time notifications to any connected clients via socket.io rooms

Drones advance their tasks whether or not the owning player is online.

---

## Socket.IO Protocol

The client-server protocol is event-based. All commands require a successful auth handshake first.

### Auth

| Client → Server | Server → Client | Payload |
|---|---|---|
| `auth:register` | `auth:ok` / `auth:error` | `{ username, password }` |
| `auth:login` | `auth:ok` / `auth:error` | `{ username, password }` |

### Fleet

| Event | Direction | Description |
|---|---|---|
| `fleet:list` | C → S | Get all drones for the authenticated user |
| `fleet:drone` | C → S | Get a single drone by ID |

### Commands

| Event | Payload | Description |
|---|---|---|
| `cmd:travel` | `{ droneId, destination }` | Dispatch drone to a world location |
| `cmd:mine` | `{ droneId }` | Begin a mining cycle |
| `cmd:sell` | `{ droneId }` | Sell all cargo at current market |
| `cmd:refuel` | `{ droneId, litres? }` | Refuel at current station |

### Server Push

| Event | Trigger |
|---|---|
| `drone:arrived` | Physics tick resolves a travel task |
| `drone:mined` | Physics tick resolves a mining task |

---

## Tuning the Game

All game balance lives in `server/config/`. No code changes required.

**Add a new drone type** — add an entry to `drones.json`:
```json
"interceptor": {
  "id": "interceptor",
  "name": "Interceptor",
  "mass_kg": 8,
  "cargo_capacity_kg": 2,
  "fuel_tank_l": 15,
  "fuel_burn_rate_l_per_km": 0.10,
  "speed_kmh": 200,
  "mining_power": 0,
  "base_cost": 3000
}
```

**Add a new location** — add an entry to `world.json` with `coordinates`, `resources`, and service flags. Update `client/src/world.js` to mirror it on the client side.

**Adjust the tick rate** — change `physics_tick_interval_ms` in `economy.json`. Lower values make the world feel more responsive; higher values reduce server load.

---

## Health Check

The server exposes a minimal HTTP endpoint for monitoring and Docker healthchecks:

```
GET http://localhost:3000/health
→ { "status": "ok", "uptime": 42.3 }
```

---

## License

MIT
