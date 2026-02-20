'use strict';

const world = require('../../world');
const { term, clearContent, renderDroneLog } = require('../layout');

// ─── Drone action menu ────────────────────────────────────────────────────────

async function showDroneActionMenu(drone) {
  clearContent(4);
  term.bold.white(`  DRONE: ${drone.name}\n\n`);

  const items = ['Status', 'Commands', 'Scan', '← Back'];
  const result = await term.singleColumnMenu(items, {
    style: term.white,
    selectedStyle: term.bgBlue.white.bold,
    leftPadding: '  ',
  }).promise;

  renderDroneLog(drone.id);
  return result.selectedText;
}

// ─── Drone command menu ───────────────────────────────────────────────────────

async function showDroneCommandMenu(drone) {
  clearContent(4);
  term.bold.white(`  COMMANDS: ${drone.name}\n\n`);

  const items = ['Travel', 'Mine', 'Sell Cargo', 'Refuel', '← Back'];
  const result = await term.singleColumnMenu(items, {
    style: term.white,
    selectedStyle: term.bgBlue.white.bold,
    leftPadding: '  ',
  }).promise;

  renderDroneLog(drone.id);
  return result.selectedText;
}

// ─── Drone detail ─────────────────────────────────────────────────────────────

function renderDroneDetail(drone) {
  clearContent(4);
  term.bold.cyan('  ── DRONE STATUS ──\n\n');

  term.bold.white(`  Name: ${drone.name}\n`);
  term.white(`  Type: ${drone.type_id}\n`);
  term.white(`  Status: ${drone.status}\n`);
  term.white(`  Location: ${drone.location_id}\n`);
  term.white(`  Fuel: ${drone.fuel_current_l.toFixed(1)}L / ${drone.spec?.fuel_tank_l ?? '?'}L\n`);

  if (drone.spec) {
    term.white(`  Burn Rate: ${drone.spec.fuel_burn_rate_l_per_km} L/km\n`);
    term.white(`  Speed: ${drone.spec.speed_kmh} km/h\n`);
  }

  if (drone.status === 'travelling' && drone.destination_id) {
    const from = world[drone.location_id];
    const to = world[drone.destination_id];
    if (from?.coordinates && to?.coordinates) {
      const dx = to.coordinates.x - from.coordinates.x;
      const dy = to.coordinates.y - from.coordinates.y;
      const distance = Math.round(Math.sqrt(dx * dx + dy * dy));
      const fuelCost = drone.spec ? distance * drone.spec.fuel_burn_rate_l_per_km : null;
      term.white(`  Destination: ${drone.destination_id}\n`);
      term.white(`  Distance: ${distance}u\n`);
      if (fuelCost !== null) term.white(`  Fuel Cost (est): ${fuelCost.toFixed(1)}L\n`);
    }
  }

  if (drone.task_eta_at) {
    const eta = Math.max(0, drone.task_eta_at - Math.floor(Date.now() / 1000));
    term.white(`  ETA: ${eta}s\n`);
  }

  if (drone.inventory?.length) {
    term('\n');
    term.bold.white('  Cargo:\n');
    for (const item of drone.inventory) {
      term.gray(`    ${item.resource_id} × ${item.quantity_kg.toFixed(1)} kg\n`);
    }
  }

  renderDroneLog(drone.id);
}

module.exports = { showDroneActionMenu, showDroneCommandMenu, renderDroneDetail };
