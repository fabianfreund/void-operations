'use strict';

const world = require('../../world');
const { term, clearContent, renderDroneLog, isPinned } = require('../layout');

// ─── Drone action menu ────────────────────────────────────────────────────────

async function showDroneActionMenu(drone) {
  clearContent(4);
  term.bold.white(`  DRONE: ${drone.name}\n\n`);

  if (drone.status === 'offline') {
    term.bold.red('  ── DRONE OFFLINE ──\n\n');
    term.white('  This drone is offline and unavailable for commands.\n\n');
    const back = await term.singleColumnMenu(['← Back'], {
      style: term.white,
      selectedStyle: term.bgBlue.white.bold,
      leftPadding: '  ',
      y: 8,
    }).promise;
    renderDroneLog(drone.id);
    return back.selectedText;
  }

  const pinLabel = isPinned(drone.id) ? 'Unpin Drone' : 'Pin Drone';
  const items = ['Status', 'Commands', 'Rename Drone', pinLabel, '← Back'];
  const result = await term.singleColumnMenu(items, {
    style: term.white,
    selectedStyle: term.bgBlue.white.bold,
    leftPadding: '  ',
    y: 6,
  }).promise;

  renderDroneLog(drone.id);
  return result.selectedText;
}

// ─── Drone command menu ───────────────────────────────────────────────────────

async function showDroneCommandMenu(drone) {
  clearContent(4);
  term.bold.white(`  COMMANDS: ${drone.name}\n\n`);

  const items = ['Travel', 'Stop In Place', 'Scan/Comms', 'Mine', 'Sell Cargo', 'Refuel', '← Back'];
  const result = await term.singleColumnMenu(items, {
    style: term.white,
    selectedStyle: term.bgBlue.white.bold,
    leftPadding: '  ',
    y: 6,
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
  if (Number.isFinite(drone.coord_x) && Number.isFinite(drone.coord_y)) {
    term.white(`  Coordinates: (${drone.coord_x.toFixed(1)}, ${drone.coord_y.toFixed(1)})\n`);
  }
  term.white(`  Fuel: ${drone.fuel_current_l.toFixed(1)}L / ${drone.spec?.fuel_tank_l ?? '?'}L\n`);
  if (drone.status === 'emergency') {
    term.yellow(`  Battery: ${drone.battery_remaining_sec ?? 0}s remaining\n`);
  }

  if (drone.spec) {
    term.white(`  Burn Rate: ${drone.spec.fuel_burn_rate_l_per_km} L/km\n`);
    term.white(`  Speed: ${drone.spec.speed_kmh} km/h\n`);
  }

  if (drone.status === 'travelling' && drone.destination_id) {
    const fromCoords = Number.isFinite(drone.task_origin_x) && Number.isFinite(drone.task_origin_y)
      ? { x: drone.task_origin_x, y: drone.task_origin_y }
      : Number.isFinite(drone.coord_x) && Number.isFinite(drone.coord_y)
        ? { x: drone.coord_x, y: drone.coord_y }
        : world[drone.location_id]?.coordinates;
    const to = world[drone.destination_id];
    if (fromCoords && to?.coordinates) {
      const dx = to.coordinates.x - fromCoords.x;
      const dy = to.coordinates.y - fromCoords.y;
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

async function promptDroneName(currentName, droneId = null) {
  clearContent(4);
  term.moveTo(1, 4);
  term.bold.cyan('  ── RENAME DRONE ──\n\n');
  term.gray('  Type a new name, then press ENTER.\n\n');
  term.white('  New Name: ');
  const nextName = ((await term.inputField({
    cancelable: true,
    default: currentName ?? '',
  }).promise) ?? '').trim();
  term('\n');
  if (!nextName) {
    if (droneId) renderDroneLog(droneId);
    return '';
  }

  clearContent(4);
  term.bold.cyan('  ── CONFIRM RENAME ──\n\n');
  term.white(`  Current: ${currentName ?? 'Unnamed'}\n`);
  term.white(`  New:     ${nextName}\n\n`);

  const confirm = await term.singleColumnMenu(['Confirm Rename', 'Cancel'], {
    style: term.white,
    selectedStyle: term.bgBlue.white.bold,
    leftPadding: '  ',
    y: 9,
  }).promise;

  if (droneId) renderDroneLog(droneId);
  if (confirm.selectedText !== 'Confirm Rename') return '';
  return nextName;
}

module.exports = { showDroneActionMenu, showDroneCommandMenu, renderDroneDetail, promptDroneName };
