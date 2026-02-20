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

### 3.1 Hulls & Modules — Full Sandbox Fitting

There are **no ship types**. Instead, players buy a **hull** (a bare frame in one of five sizes) and fill it with any combination of modules they like. Weight is the only constraint. Want a fast scout? Light hull + thrusters + tank + comms. Want a mining platform? Medium hull + 3× mining lasers + 2× cargo holds + fat tank. Every ship is custom-built.

---

#### Hulls

`server/config/hulls.json` replaces `drones.json`:

```jsonc
{
  "hull_xs": {
    "name": "Hull XS",
    "description": "A stripped frame. You'll be surprised what fits.",
    "base_mass_kg": 5,
    "capacity_kg": 25,
    "hull_points": 50,
    "cost": 300
  },
  "hull_s": {
    "name": "Hull S",
    "description": "Standard starter frame. Versatile.",
    "base_mass_kg": 12,
    "capacity_kg": 60,
    "hull_points": 100,
    "cost": 900
  },
  "hull_m": {
    "name": "Hull M",
    "description": "Room for a real loadout.",
    "base_mass_kg": 35,
    "capacity_kg": 160,
    "hull_points": 250,
    "cost": 4000
  },
  "hull_l": {
    "name": "Hull L",
    "description": "Industrial-grade. Heavy but capable.",
    "base_mass_kg": 90,
    "capacity_kg": 420,
    "hull_points": 600,
    "cost": 14000
  },
  "hull_xl": {
    "name": "Hull XL",
    "description": "Capital-class frame. Fill it with everything.",
    "base_mass_kg": 250,
    "capacity_kg": 1050,
    "hull_points": 1500,
    "cost": 50000
  }
}
```

- **`capacity_kg`** — total module weight the hull can hold. This is the only fitting constraint.
- **`hull_points`** — base structural integrity. Hull plating modules add to this.
- **`base_mass_kg`** — empty hull weight; included when calculating thrust-to-mass ratio.

Hull upgrade at a shipyard: uninstalls all modules, swaps to the new hull (if capacity of new hull ≥ total current module mass, modules are automatically re-fitted; otherwise player must remove some first).

---

#### Modules

`server/config/modules.json` — any module can be installed in any hull, any number of times, as long as total module mass stays within `capacity_kg`.

**No type restrictions. No slot limits. Stack freely.**

```jsonc
{
  "thruster_mk1": {
    "name": "Thruster Mk1",
    "description": "Standard ion drive. Rated for ~40 kg total ship mass.",
    "mass_kg": 4,
    "cost": 600,
    "stats": {
      "thrust_rating_kg": 40,
      "base_speed_kmh": 75,
      "fuel_burn_base_l_per_km": 0.14
    }
  },
  "thruster_mk2": {
    "name": "Thruster Mk2",
    "description": "Efficiency coils and upgraded combustion chamber.",
    "mass_kg": 6,
    "cost": 2200,
    "stats": {
      "thrust_rating_kg": 70,
      "base_speed_kmh": 110,
      "fuel_burn_base_l_per_km": 0.11
    }
  },
  "thruster_mk3": {
    "name": "Thruster Mk3",
    "description": "Military-grade plasma drive.",
    "mass_kg": 9,
    "cost": 7500,
    "stats": {
      "thrust_rating_kg": 130,
      "base_speed_kmh": 160,
      "fuel_burn_base_l_per_km": 0.08
    }
  },
  "fuel_tank_s": {
    "name": "Fuel Tank S",
    "description": "Small pressurised hydrogen cell.",
    "mass_kg": 3,
    "cost": 300,
    "stats": { "fuel_tank_l": 20 }
  },
  "fuel_tank_m": {
    "name": "Fuel Tank M",
    "mass_kg": 7,
    "cost": 800,
    "stats": { "fuel_tank_l": 50 }
  },
  "fuel_tank_l": {
    "name": "Fuel Tank L",
    "mass_kg": 15,
    "cost": 2000,
    "stats": { "fuel_tank_l": 130 }
  },
  "comms_basic": {
    "name": "Comms Array",
    "description": "Basic radio link. Required for server contact.",
    "mass_kg": 2,
    "cost": 200,
    "stats": {
      "scan_radius_km": 200,
      "comms_active": true
    }
  },
  "comms_relay": {
    "name": "Relay Comms",
    "description": "Extended range communication array.",
    "mass_kg": 4,
    "cost": 1100,
    "stats": {
      "scan_radius_km": 450,
      "comms_active": true
    }
  },
  "mining_laser_mk1": {
    "name": "Mining Laser Mk1",
    "description": "Entry-level extraction laser.",
    "mass_kg": 10,
    "cost": 800,
    "stats": {
      "mining_power": 8,
      "yield_multiplier": 1.0
    }
  },
  "mining_laser_mk2": {
    "name": "Mining Laser Mk2",
    "mass_kg": 14,
    "cost": 3000,
    "stats": {
      "mining_power": 18,
      "yield_multiplier": 1.25
    }
  },
  "mining_laser_mk3": {
    "name": "Mining Laser Mk3",
    "description": "Industrial-grade. Eats rock for breakfast.",
    "mass_kg": 20,
    "cost": 9000,
    "stats": {
      "mining_power": 35,
      "yield_multiplier": 1.6
    }
  },
  "cargo_hold_s": {
    "name": "Cargo Hold S",
    "mass_kg": 8,
    "cost": 400,
    "stats": { "cargo_kg": 50 }
  },
  "cargo_hold_m": {
    "name": "Cargo Hold M",
    "mass_kg": 18,
    "cost": 1200,
    "stats": { "cargo_kg": 140 }
  },
  "cargo_hold_l": {
    "name": "Cargo Hold L",
    "mass_kg": 40,
    "cost": 3500,
    "stats": { "cargo_kg": 380 }
  },
  "hull_plating_light": {
    "name": "Light Hull Plating",
    "description": "Basic ceramic impact protection.",
    "mass_kg": 5,
    "cost": 500,
    "stats": {
      "hull_points_bonus": 40,
      "damage_reduction_pct": 0.05
    }
  },
  "hull_plating_heavy": {
    "name": "Heavy Hull Plating",
    "description": "Composite alloy. Serious protection, serious weight.",
    "mass_kg": 14,
    "cost": 2800,
    "stats": {
      "hull_points_bonus": 140,
      "damage_reduction_pct": 0.18
    }
  },
  "sensor_passive": {
    "name": "Passive Sensor Suite",
    "mass_kg": 3,
    "cost": 700,
    "stats": {
      "scan_radius_km": 150,
      "reveal_hidden": false
    }
  },
  "sensor_active": {
    "name": "Active Sensor Array",
    "description": "Long-range sweep. Can reveal hidden locations.",
    "mass_kg": 6,
    "cost": 2500,
    "stats": {
      "scan_radius_km": 350,
      "reveal_hidden": true
    }
  }
}
```

Modules are purchased individually at stations. A single module purchase puts it in your **ship's workshop bay** (installed immediately). You must be docked at a station with `has_shipyard` to install/remove modules.

---

#### Thrust-to-Mass Physics

Speed and fuel burn are not static — they scale with how much thrust you have relative to total ship mass.

```
total_mass      = hull.base_mass_kg + sum(installed modules mass_kg)
total_thrust    = sum(thruster.thrust_rating_kg)   // 0 if no thrusters = can't fly
thrust_ratio    = total_thrust / total_mass         // 1.0 = perfectly rated; <1 = overloaded

effective_speed = sum(thruster.base_speed_kmh) * sqrt(thrust_ratio)
effective_burn  = sum(thruster.fuel_burn_base_l_per_km) * (1 / thrust_ratio)
```

**Examples:**
| Loadout | Total mass | Thrust | Ratio | Speed | Burn |
|---|---|---|---|---|---|
| Hull S + Thruster Mk1 + Tank S + Comms | 22 kg | 40 kg | 1.82 | ~101 km/h | 0.10 L/km |
| Hull M + 2× Thruster Mk1 + Cargo L + Tank M + Comms | 82 kg | 80 kg | 0.98 | ~148 km/h | 0.28 L/km |
| Hull M + Thruster Mk1 + 3× Mining Laser Mk2 + Cargo M + Tank S | 107 kg | 40 kg | 0.37 | ~45 km/h | 0.37 L/km |

A drone with no thruster module **cannot travel** — the server rejects dispatch. A drone with no comms module **cannot scan**. A drone with no cargo hold **cannot mine** (nowhere to put ore).

---

#### Starting Ship

New players receive a **Hull S** pre-fitted with the minimum viable loadout:

```
Hull S            (60 kg capacity, 100 hull pts)
  Thruster Mk1    4 kg   — speed / fuel burn
  Fuel Tank S     3 kg   — 20 L capacity
  Comms Array     2 kg   — scan + server link
─────────────────────────
Module mass:      9 kg   (51 kg remaining capacity)
```

No cargo hold → cannot mine yet. No mining laser → cannot mine yet. First decision: spend starting credits on a `Mining Laser Mk1` (800 cr, 10 kg) + `Cargo Hold S` (400 cr, 8 kg). That uses 19 of 51 remaining kg. Ship becomes a miner. Or buy more tank, or a sensor array — fully up to the player.

---

#### DB

```sql
-- drones table: rename type_id → hull_type_id via migration alias
-- (keep column name type_id for zero-migration-risk; server reads it as hull_type_id internally)

CREATE TABLE IF NOT EXISTS drone_modules (
  id             TEXT PRIMARY KEY,
  drone_id       TEXT NOT NULL REFERENCES drones(id) ON DELETE CASCADE,
  module_type_id TEXT NOT NULL,     -- 'thruster_mk2', 'cargo_hold_l', etc.
  installed_at   INTEGER DEFAULT unixepoch()
  -- NO unique constraint — stacking is allowed
);
```

---

#### `getEffectiveStats(droneId)` — central function in `modules.js`

```js
{
  // Hull
  hull_type: 'hull_s',
  hull_base_points: 100,
  capacity_kg: 60,
  base_mass_kg: 12,

  // Summed from modules
  total_module_mass_kg: 27,
  total_mass_kg: 39,
  capacity_used_kg: 27,
  capacity_remaining_kg: 33,

  // Thrust calc
  total_thrust_rating_kg: 40,
  thrust_ratio: 1.026,

  // Derived performance
  effective_speed_kmh: 76,
  effective_burn_l_per_km: 0.136,
  fuel_tank_l: 20,
  cargo_kg: 140,
  mining_power: 8,
  yield_multiplier: 1.0,
  scan_radius_km: 200,
  reveal_hidden: false,
  hull_points_total: 100,       // hull_base + sum(hull_plating_bonus)
  damage_reduction_pct: 0,
  can_travel: true,             // has at least 1 thruster
  can_mine: true,               // has mining_power > 0 AND cargo_kg > 0
  can_scan: true,               // has comms_active: true

  // Per-module breakdown (for UI display)
  modules: [
    { id: 'abc', type: 'thruster_mk1', name: 'Thruster Mk1', mass_kg: 4,
      stats: { thrust_rating_kg: 40, base_speed_kmh: 75, fuel_burn_base_l_per_km: 0.14 } },
    { id: 'def', type: 'fuel_tank_s',  name: 'Fuel Tank S',  mass_kg: 3,
      stats: { fuel_tank_l: 20 } },
    { id: 'ghi', type: 'comms_basic',  name: 'Comms Array',  mass_kg: 2,
      stats: { scan_radius_km: 200, comms_active: true } }
  ]
}
```

Physics, mining, refuel, and repair call `getEffectiveStats()`. The raw hull spec is never used directly after startup.

---

#### Module Display in Every Menu

`enrichDrone()` always embeds `getEffectiveStats()`. The client renders a **LOADOUT** block in drone detail and in the workshop:

```
HULL: Hull S   [27/60 kg used]   Hull: 100 pts

LOADOUT
  Thruster Mk1      4 kg    thrust: 40 kg   speed: ×1.00   burn: 0.14 L/km
  Fuel Tank S       3 kg    capacity: 20 L
  Comms Array       2 kg    scan: 200 km
  Mining Laser Mk1  10 kg   power: 8   yield: ×1.0
  Cargo Hold S      8 kg    cargo: 50 kg

EFFECTIVE
  Speed: 76 km/h   Burn: 0.136 L/km   Cargo: 50 kg   Scan: 200 km
  Can travel: YES   Can mine: YES   Can scan: YES
```

The workshop view additionally shows available modules at the current station, their mass, cost, and what they'd do to the ship's effective stats if installed (preview mode).

---

### 3.2 Hull Integrity & Repair

Hull points come from the hull's `hull_points` base plus any `hull_plating` modules installed. Hull degrades from mining danger and emergency landings. At 0 the drone is **destroyed**.

**Config additions in `world.json` (per mining zone):**
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
hull_current   REAL DEFAULT 100
```
(`hull_max` is computed from hull spec + plating modules at runtime — not stored.)

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
├── hulls.json           NEW — replaces drones.json; hull sizes with capacity_kg, hull_points, cost
├── drones.json          REMOVED — all drone-type logic replaced by hull + module system
├── world.json           existing — add danger_level, damage ranges per zone; richness stays
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
-- hull_max is computed from chassis hull_base + hull_plating module, but we cache it here for tick performance
ALTER TABLE drones ADD COLUMN hull_current REAL DEFAULT 100;

-- New tables
CREATE TABLE IF NOT EXISTS drone_modules (
  id             TEXT PRIMARY KEY,
  drone_id       TEXT NOT NULL REFERENCES drones(id) ON DELETE CASCADE,
  family         TEXT NOT NULL,        -- 'thruster' | 'fuel_tank' | 'comms' | etc.
  module_type_id TEXT NOT NULL,        -- 'thruster_mk2' etc.
  installed_at   INTEGER DEFAULT unixepoch(),
  UNIQUE(drone_id, family)             -- one module per family per drone
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
| `cmd:install_module` `{ droneId, moduleTypeId }` | Purchase + install a module (must be at a shipyard selling it) |
| `cmd:remove_module` `{ droneId, moduleInstanceId }` | Remove a specific installed module instance — free, no refund |
| `cmd:buy_hull` `{ locationId, hullTypeId, name }` | Purchase a new bare hull (spawns with no modules) |
| `cmd:upgrade_hull` `{ droneId, hullTypeId }` | Upgrade drone to a larger hull at a shipyard |
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

## 10. Decided

| Question | Decision |
|---|---|
| Ship types (scout/miner/hauler) | **Removed** — replaced by hull sizes (XS → XL) |
| Module restrictions per ship type | **None** — any module in any hull, full sandbox |
| How many of one module can you fit? | **Unlimited** — constrained only by hull `capacity_kg` |
| Thruster mechanics | **Thrust-to-mass ratio** — overloaded = slower + higher burn; underloaded = faster |
| Default modules removable? | **Yes, all freely removable** — no locked modules; player can choose to fly with no cargo hold if they want |
| Module removal refund | **Free removal, no credits returned** |
| Module stats visible in all menus | **Yes** — `enrichDrone()` always includes full loadout + effective stats |
| Starting ship | **Hull S + Thruster Mk1 + Fuel Tank S + Comms Array** (no mining capability by default) |

## 11. Open Questions (decide before Phase 1)

1. **Drone destruction**: Permanent loss, or recoverable for a fee at a shipyard within N ticks?
2. **Contract competition**: First-claim wins (all players see same contracts), or player-specific generated contracts?
3. **Fuel station stock**: Tracked supply that can run dry, or always available if station has refuel service?
4. **AI trigger**: Every physics tick, slower independent timer, or only while ≥ 1 player is online?
5. **Hull upgrade transfer**: When upgrading to a larger hull, auto-refit modules if they fit, or always require manual re-fitting?
