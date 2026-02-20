# VOID OPERATIONS — DEPTH PROPOSAL

> Status: Draft — for review before implementation begins.

---

## 1. Vision

The current game is functional but thin: mine → sell → refuel → repeat. The goal is to add interlocking systems that make every decision matter — where you fly, what drone you fit, which station you trade at — while laying a clean foundation for an AI model to observe and influence world state.

All new mechanics will be **config-driven** (no magic numbers in code), **file-split** (one system per file), and **schema-additive** (no breaking schema changes, only migrations).

---

## 2. What Exists Today

| System | State |
|---|---|
| Drone types | 4 types, static stats |
| Locations | 11 locations, binary service flags |
| Economy | Global price volatility on sell, fixed fuel price |
| Mining | Single yield formula, one resource per zone per tick |
| Repair | Cost defined in economy.json, no hull tracking |
| Modules | Not implemented |
| Danger | Not implemented |
| Contracts | Not implemented |
| Supply/demand | Not implemented |
| AI hooks | Not implemented |

---

## 3. Proposed Systems

### 3.1 Ship Modules

Drones can be fitted with modules at stations that have a **shipyard** service. Modules modify base stats multiplicatively or additively. Each drone type has a fixed number of slots per category.

**Module categories:**
| Category | Effect examples |
|---|---|
| `engine` | +speed%, -burn rate |
| `cargo` | +cargo capacity kg |
| `mining` | +mining power, +yield multiplier |
| `hull` | +max hull points, -damage taken % |
| `sensor` | +scan radius, reveal hidden locations |

**Config:** `server/config/modules.json` — one entry per module type:
```jsonc
{
  "engine_mk1": {
    "name": "Thruster Mk1",
    "category": "engine",
    "mass_kg": 4,
    "cost": 800,
    "effects": { "speed_multiplier": 1.15 }
  },
  "cargo_ext_mk1": {
    "name": "Cargo Extender Mk1",
    "category": "cargo",
    "mass_kg": 8,
    "cost": 1200,
    "effects": { "cargo_kg_bonus": 40 }
  }
  // ...
}
```

**Config:** `server/config/drones.json` — add `module_slots` per type:
```jsonc
{
  "miner_mk2": {
    "module_slots": { "engine": 1, "cargo": 2, "mining": 1, "hull": 1, "sensor": 0 }
  }
}
```

**DB:** `drone_modules(id, drone_id, module_type_id, slot_index, installed_at)`

**New system:** `server/src/systems/modules.js`
- `installModule(droneId, moduleTypeId)` — validates slot availability, deducts credits, inserts row
- `removeModule(droneId, moduleId)` — removes row, refunds 50% cost
- `getEffectiveStats(droneId)` — base spec + summed module effects → used everywhere speed/cargo/mining is needed

**Physics integration:** `physics.js` calls `getEffectiveStats()` instead of raw spec — so fitted modules change travel time, fuel burn, and mining yield automatically.

---

### 3.2 Hull Integrity & Repair

Drones have hull points. Hull degrades from mining danger, travel through dangerous zones, and emergency landings. At 0 hull the drone is **destroyed** (not just offline).

**Config additions in `drones.json`:**
```jsonc
{ "scout": { "hull_max": 100 } }
```

**Config additions in `world.json`:**
```jsonc
{
  "asteroid_belt_a": {
    "danger_level": 0.35,
    "damage_per_mine_cycle": { "min": 2, "max": 8 }
  }
}
```

**DB:** Add to `drones` table:
```sql
hull_current   REAL DEFAULT 100,
hull_max       REAL DEFAULT 100
```

**Damage events (in `physics.js` tick):**
- After each mining cycle: `damage = rand(min, max) * danger_level`, clamped to `hull_current`
- After an emergency landing: fixed penalty (e.g. 15 hull)
- Hull < 25% → emit `drone:critical` push event

**Repair (`server/src/systems/repair.js`):**
```js
repairDrone(droneId, hullPoints?)   // repairs full or partial
// cost = hull_points * economy.json → repair_cost_per_hull_point
// drone must be idle, location must have has_repair service
```

**Destruction:** If `hull_current <= 0` during tick:
- Drone status → `destroyed`
- Inventory cleared (cargo lost)
- Emit `drone:destroyed` push event
- Drone stays in DB for history; filtered out of active fleet

---

### 3.3 Deep Economy — Supply & Demand

Prices at each market station are no longer globally random per-sell. They reflect **local supply/demand** and move over time.

**How it works:**
- Each station+resource pair has a `supply_kg` (stock held by the station's market)
- Selling increases supply → price drops
- Buying/NPC consumption decreases supply → price rises
- Price formula: `price = base_price * demand_multiplier(supply)` where demand is inverse of supply saturation

**Config:** `server/config/economy.json` additions:
```jsonc
{
  "market_supply_cap_kg": 5000,
  "market_supply_recovery_rate": 0.02,
  "market_supply_initial_fraction": 0.5,
  "price_floor_multiplier": 0.4,
  "price_ceiling_multiplier": 2.5
}
```

**DB:** New table:
```sql
market_state (
  id          INTEGER PRIMARY KEY,
  location_id TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  supply_kg   REAL DEFAULT 0,
  last_price  REAL,
  updated_at  INTEGER DEFAULT unixepoch(),
  UNIQUE(location_id, resource_id)
)
```

**New system:** `server/src/systems/market.js`
- `getCurrentPrice(locationId, resourceId)` — reads supply, computes live price
- `recordSale(locationId, resourceId, quantityKg)` — updates supply upward, logs price
- `tickMarket()` — called inside physics tick: decays supply slightly toward mid-point (simulating NPC demand), logs price history point

**Socket event:** `market:prices` — clients can request current station prices before deciding where to sell.

---

### 3.4 Station Shops — Per-Station Inventory

Each station offers different things. Stations with `has_shipyard` sell drones and modules. Stations with `has_market` buy resources. Each is configured independently.

**Config:** `server/config/stations.json` — replaces scattered service flags in `world.json`:
```jsonc
{
  "hub": {
    "services": ["market", "refuel", "repair", "shipyard"],
    "drone_types_available": ["scout", "miner_mk1", "miner_mk2", "hauler"],
    "modules_available": ["engine_mk1", "cargo_ext_mk1", "hull_plate_mk1"],
    "fuel_stock_l": 50000,
    "fuel_price_multiplier": 1.0,
    "npc_flavor": "The heart of Asteria — busy, expensive, reliable."
  },
  "vega_shipyard": {
    "services": ["repair", "shipyard"],
    "drone_types_available": ["miner_mk2", "hauler"],
    "modules_available": ["engine_mk2", "mining_laser_mk2", "sensor_array_mk1"],
    "fuel_stock_l": 0,
    "npc_flavor": "Military contracts keep the lights on. Civilians welcome, barely."
  },
  "deep_void_outpost": {
    "services": ["market", "refuel"],
    "drone_types_available": [],
    "modules_available": ["black_market_overclock"],
    "fuel_price_multiplier": 2.2,
    "npc_flavor": "Nobody asks questions at the edge of the map."
  }
}
```

**`world.json`** retains coordinates, resources, richness, danger. `stations.json` owns service/shop data. Both are merged server-side into a unified location object.

**New socket events:**
- `shop:modules` — list modules available at current station + prices
- `shop:drones` — list drone types for purchase
- `cmd:buy_module` — purchase and install a module
- `cmd:buy_drone` — purchase a new drone (docked at station)

**New system:** `server/src/systems/shop.js`
- `listModules(locationId)` — reads `stations.json`, returns available modules with current prices
- `listDrones(locationId)` — reads `stations.json`, returns purchasable drone specs
- `buyDrone(userId, locationId, typeId, name)` — validates credits, creates drone at station

---

### 3.5 Contracts

Stations periodically generate delivery/mining contracts. Players accept them for bonus credits on completion. Contracts give purpose to specific trade routes.

**Config:** `server/config/contracts.json`:
```jsonc
{
  "generation_interval_ticks": 3,
  "max_active_per_station": 5,
  "contract_templates": [
    {
      "type": "deliver",
      "resource": "iron",
      "quantity_range": [100, 500],
      "reward_per_kg": 3.5,
      "expiry_ticks": 20
    },
    {
      "type": "mine",
      "resource": "titanium",
      "quantity_range": [50, 200],
      "reward_per_kg": 12,
      "expiry_ticks": 30
    }
  ]
}
```

**DB:**
```sql
contracts (
  id            TEXT PRIMARY KEY,
  station_id    TEXT NOT NULL,
  owner_id      TEXT,                -- NULL if unclaimed
  type          TEXT NOT NULL,       -- 'deliver' | 'mine'
  resource_id   TEXT NOT NULL,
  quantity_kg   REAL NOT NULL,
  filled_kg     REAL DEFAULT 0,
  reward_cr     REAL NOT NULL,
  expires_at    INTEGER NOT NULL,
  status        TEXT DEFAULT 'open', -- open | active | complete | expired
  created_at    INTEGER DEFAULT unixepoch()
)
```

**New system:** `server/src/systems/contracts.js`
- `generateContracts(io)` — called in physics tick every N ticks, fills expired slots
- `acceptContract(userId, contractId)` — claims contract for player
- `checkContractProgress(droneId)` — on sell, checks if filled a contract, awards bonus

**Socket events:**
- `contracts:list` — all open contracts + player's active contracts
- `cmd:accept_contract` — claim a contract

---

### 3.6 Danger Events

Travelling and mining are no longer consequence-free. Each tick iteration checks for random danger events based on location `danger_level`.

**Config:** `server/config/combat.json`:
```jsonc
{
  "pirate_encounter_base_prob": 0.05,
  "pirate_scales_with_danger": true,
  "cargo_theft_fraction": { "min": 0.1, "max": 0.4 },
  "hull_damage_on_encounter": { "min": 5, "max": 25 },
  "sensor_module_reduces_prob": 0.5
}
```

**Events (in physics tick):**
- **Pirate encounter**: probability scales with `danger_level * base_prob`. On hit: steal random fraction of cargo, deal hull damage. Emit `drone:pirate_encounter` with details.
- **Micro-collision** (mining zones): small hull damage per cycle (already in 3.2)
- **Fuel cache found**: rare positive event — small fuel bonus. Emit `drone:fuel_cache`.

These are rolled per-drone per-tick pass, not a separate system — integrated cleanly into `tick()` logic block.

---

### 3.7 AI Integration Layer — Entity Variables

Every entity needs a rich, structured state object so an AI model can read the full world and make decisions (adjusting prices, spawning events, shifting NPC demand, sending broadcasts).

**Principle:** All AI-relevant state is **already in DB** or **computable from DB** — no shadow state. The AI layer just reads and writes through existing systems.

**New system:** `server/src/systems/ai-context.js`
```js
buildWorldSnapshot()  // returns full world state as a JSON object
applyAIDecision(decision)  // applies a structured AI decision object
```

**World snapshot schema (what the AI receives):**

```jsonc
{
  "timestamp": 1234567890,
  "tick_count": 412,
  "active_players": 3,
  "economy": {
    "resources": {
      "iron": {
        "global_avg_price": 8.2,
        "stations": {
          "hub": { "supply_kg": 2400, "current_price": 7.1, "sold_last_10_ticks": 850 },
          "lyra_trade_hub": { "supply_kg": 180, "current_price": 10.4, "sold_last_10_ticks": 120 }
        }
      }
    },
    "fuel": {
      "hub": { "stock_l": 42000, "price_per_l": 1.2 }
    }
  },
  "locations": {
    "asteroid_belt_a": {
      "drone_count": 2,
      "richness": 0.7,
      "danger_level": 0.35,
      "danger_events_last_10_ticks": 1
    }
  },
  "players": [
    {
      "id": "abc",
      "credits": 12400,
      "fleet_size": 3,
      "active_drones": 2,
      "play_style_score": { "miner": 0.8, "trader": 0.2, "explorer": 0.0 },
      "wealth_growth_rate_per_tick": 340,
      "last_active_ticks_ago": 1
    }
  ],
  "contracts": {
    "open": 4,
    "active": 2,
    "completed_last_10_ticks": 7
  }
}
```

**AI decision schema (what the AI can output):**

```jsonc
{
  "market_adjustments": [
    { "location_id": "lyra_trade_hub", "resource_id": "iron", "supply_delta_kg": -500 }
  ],
  "danger_adjustments": [
    { "location_id": "asteroid_belt_b", "danger_level": 0.6 }
  ],
  "spawn_events": [
    { "type": "broadcast", "message": "Pirate faction activity increasing near Kessler Belt." },
    { "type": "bonus_contract", "station_id": "hub", "resource": "titanium", "quantity_kg": 300, "reward_cr": 8000 }
  ],
  "richness_adjustments": [
    { "location_id": "asteroid_field_delta", "richness_delta": -0.1 }
  ]
}
```

**Drone entity — new tracked fields:**

```sql
-- Added to drones table:
hull_current       REAL DEFAULT 100,
hull_max           REAL DEFAULT 100,

-- New table: drone_stats (one row per drone, updated on events)
drone_stats (
  drone_id          TEXT PRIMARY KEY REFERENCES drones(id),
  total_trips       INTEGER DEFAULT 0,
  total_cargo_kg    REAL DEFAULT 0,
  total_credits_earned REAL DEFAULT 0,
  total_hull_damage REAL DEFAULT 0,
  pirate_encounters INTEGER DEFAULT 0,
  mining_cycles     INTEGER DEFAULT 0,
  created_at        INTEGER DEFAULT unixepoch()
)
```

**Player entity — new derived metrics (computed, not stored):**
Computed by `ai-context.js` from event_log + drone_stats, not in the hot path.

---

## 4. Config File Architecture

```
server/config/
├── drones.json          existing — add module_slots, hull_max
├── world.json           existing — add danger_level, damage ranges, richness stays
├── economy.json         existing — add supply/demand params
├── modules.json         NEW — all module type definitions
├── stations.json        NEW — per-station services, shop inventory, fuel stock
├── contracts.json       NEW — contract templates, generation config
└── combat.json          NEW — danger event probabilities, pirate config
```

Each file is independently loadable, validated on server startup with a schema check that logs warnings (not crashes) for unknown keys. The server reads all configs at startup into a single `CONFIG` object accessible across systems.

**New server module:** `server/src/config/loader.js`
- `loadAll()` — reads all JSON files, validates schema, returns merged config
- `get(path)` — dot-notation access: `CONFIG.get('modules.engine_mk1.effects')`

---

## 5. Database Schema Changes

All additions via **lightweight migrations** (same pattern as existing `org_name`, `coord_x`, etc.):

```sql
-- Additions to drones table
ALTER TABLE drones ADD COLUMN hull_current REAL DEFAULT 100;
ALTER TABLE drones ADD COLUMN hull_max REAL DEFAULT 100;

-- New tables
CREATE TABLE IF NOT EXISTS drone_modules (
  id             TEXT PRIMARY KEY,
  drone_id       TEXT NOT NULL REFERENCES drones(id) ON DELETE CASCADE,
  module_type_id TEXT NOT NULL,
  slot_index     INTEGER NOT NULL,
  installed_at   INTEGER DEFAULT unixepoch()
);

CREATE TABLE IF NOT EXISTS drone_stats (
  drone_id             TEXT PRIMARY KEY REFERENCES drones(id) ON DELETE CASCADE,
  total_trips          INTEGER DEFAULT 0,
  total_cargo_kg       REAL DEFAULT 0,
  total_credits_earned REAL DEFAULT 0,
  total_hull_damage    REAL DEFAULT 0,
  pirate_encounters    INTEGER DEFAULT 0,
  mining_cycles        INTEGER DEFAULT 0,
  updated_at           INTEGER DEFAULT unixepoch()
);

CREATE TABLE IF NOT EXISTS market_state (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  location_id TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  supply_kg   REAL DEFAULT 0,
  last_price  REAL,
  updated_at  INTEGER DEFAULT unixepoch(),
  UNIQUE(location_id, resource_id)
);

CREATE TABLE IF NOT EXISTS contracts (
  id          TEXT PRIMARY KEY,
  station_id  TEXT NOT NULL,
  owner_id    TEXT REFERENCES users(id),
  type        TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  quantity_kg REAL NOT NULL,
  filled_kg   REAL DEFAULT 0,
  reward_cr   REAL NOT NULL,
  expires_at  INTEGER NOT NULL,
  status      TEXT DEFAULT 'open',
  created_at  INTEGER DEFAULT unixepoch()
);
```

No existing tables modified in breaking ways. All `ALTER TABLE` statements guard with column-existence checks (same pattern as current migrations).

---

## 6. Code Architecture

```
server/
├── src/
│   ├── config/
│   │   └── loader.js          NEW — config load + validation
│   ├── models/
│   │   ├── user.js            existing
│   │   ├── drone.js           existing — add hull fields
│   │   ├── module.js          NEW — drone_modules CRUD
│   │   ├── market.js          NEW — market_state CRUD
│   │   ├── contract.js        NEW — contracts CRUD
│   │   └── stats.js           NEW — drone_stats upserts
│   ├── systems/
│   │   ├── physics.js         existing — integrate modules, hull, danger events
│   │   ├── mining.js          existing — integrate hull damage, contracts check
│   │   ├── modules.js         NEW — install/remove/compute effective stats
│   │   ├── repair.js          NEW — repair logic (was inline, now explicit)
│   │   ├── market.js          NEW — supply/demand price engine
│   │   ├── shop.js            NEW — drone/module purchase
│   │   ├── contracts.js       NEW — generation, accept, completion check
│   │   └── ai-context.js      NEW — world snapshot + decision application
│   └── network/
│       └── socketHandler.js   existing — add new socket events
```

```
client/
└── src/
    └── ui/
        └── pages/
            ├── shop.js        NEW — module/drone purchase UI
            ├── contracts.js   NEW — browse/accept contracts UI
            └── market.js      NEW — price board UI per station
```

---

## 7. New Socket Events Summary

| Event (client → server) | Description |
|---|---|
| `market:prices` | Get current prices at a station |
| `shop:modules` | List modules available at station |
| `shop:drones` | List drones available at station |
| `cmd:buy_module` `{ droneId, moduleTypeId }` | Purchase + install module |
| `cmd:remove_module` `{ droneId, moduleId }` | Uninstall module |
| `cmd:buy_drone` `{ locationId, typeId, name }` | Purchase new drone |
| `cmd:repair` `{ droneId, hullPoints? }` | Repair drone |
| `contracts:list` `{ locationId? }` | Open + my active contracts |
| `cmd:accept_contract` `{ contractId }` | Claim a contract |

| Event (server → client push) | Trigger |
|---|---|
| `drone:hull_damage` | Hull damage event during mining/travel |
| `drone:critical` | Hull < 25% |
| `drone:destroyed` | Hull reaches 0 |
| `drone:pirate_encounter` | Pirate event during tick |
| `drone:fuel_cache` | Rare positive fuel event |
| `contract:completed` | Player finishes a contract |
| `world:event` | AI-triggered broadcast or world event |

---

## 8. Implementation Plan

### Phase 0 — Foundation (1 session)
- `server/src/config/loader.js` — unified config loader
- Migrate all systems to use `CONFIG.get()` instead of raw `require()`
- Add DB migrations for new tables/columns
- `server/src/models/module.js`, `market.js`, `contract.js`, `stats.js`

### Phase 1 — Ship Modules (1–2 sessions)
- `server/config/modules.json` with 8–10 initial modules
- `server/config/stations.json` with per-station shops
- `server/src/systems/modules.js` + `shop.js`
- Update `enrichDrone()` to call `getEffectiveStats()`
- Socket handlers for `shop:*` and `cmd:buy_module/remove_module/buy_drone`
- Client: `pages/shop.js`

### Phase 2 — Hull & Repair (1 session)
- `server/config/combat.json` (damage ranges)
- Update `world.json` — add `danger_level` + `damage_per_mine_cycle` to zones
- Hull damage in `tick()` during mining
- Emergency landing hull penalty
- `server/src/systems/repair.js`
- Socket handler `cmd:repair`
- Client: repair option in drone action menu

### Phase 3 — Deep Economy (1–2 sessions)
- `server/src/systems/market.js` + `server/src/models/market.js`
- `economy.json` supply/demand params
- Initialize `market_state` table on server start
- `tickMarket()` called inside `tick()`
- Update `sellCargo()` to use `getCurrentPrice()` and call `recordSale()`
- Socket handler `market:prices`
- Client: `pages/market.js` — price board at station

### Phase 4 — Contracts (1 session)
- `server/config/contracts.json`
- `server/src/systems/contracts.js` + `server/src/models/contract.js`
- Generate contracts in `tick()`
- Check completion in `sellCargo()` / `mining` resolution
- Socket handlers `contracts:list`, `cmd:accept_contract`
- Client: `pages/contracts.js`

### Phase 5 — Danger Events (0.5 sessions)
- `server/config/combat.json` pirate/event config
- Roll danger events in `tick()` per drone
- Emit push events, update `drone_stats`

### Phase 6 — AI Context Layer (1 session)
- `server/src/systems/ai-context.js`
- `buildWorldSnapshot()` aggregating all state
- `applyAIDecision(decision)` applying structured mutations
- REST endpoint `POST /ai/snapshot` (returns world state, protected by API key)
- REST endpoint `POST /ai/decision` (receives AI decision, applies it)
- Ensure `drone_stats` + `market_state` history is rich enough for meaningful AI input

---

## 9. What Stays Unchanged

- Auth handshake protocol
- Physics tick ETA system (offline-capable)
- Emergency mode state machine
- `enrichDrone()` / `sanitizeUser()` pattern
- Client `_request()` promise wrapper
- Docker setup
- `better-sqlite3` sync DB layer

---

## 10. Open Questions (decide before Phase 1)

1. **Module removal refund**: 50% cost refund, or zero? Zero is simpler, 50% is more interesting for experimentation.
2. **Drone destruction**: Permanent loss, or recoverable for a large fee at a shipyard within N ticks?
3. **Contract competition**: Can multiple players see and race for the same contract? (currently: first-claim wins)
4. **Fuel station stock**: Should stations run low on fuel (tracked like market supply), or is fuel always available if the station has refuel service?
5. **AI trigger**: AI runs on every physics tick, or on a slower timer, or only while at least one player is online?
