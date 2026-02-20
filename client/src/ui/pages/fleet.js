'use strict';

const { term, clearContent, renderLog, renderDroneLog } = require('../layout');

const STATUS_COLOR = {
  idle: 'green',
  travelling: 'yellow',
  mining: 'cyan',
  returning: 'blue',
  offline: 'red',
};

// ─── Fleet table ──────────────────────────────────────────────────────────────

function renderFleetTable(drones) {
  clearContent(4);
  term.bold.cyan('  ── FLEET STATUS ──\n\n');

  if (!drones.length) {
    term.white('  No drones registered.\n');
    renderLog();
    return;
  }

  for (const d of drones) {
    const fuelPct = d.spec
      ? Math.round((d.fuel_current_l / d.spec.fuel_tank_l) * 100)
      : '?';
    const eta = d.task_eta_at
      ? `ETA ${Math.max(0, d.task_eta_at - Math.floor(Date.now() / 1000))}s`
      : '';

    term.bold.white(`  ${d.name}`);
    term.white(` (${d.type_id})  `);
    term[STATUS_COLOR[d.status] ?? 'white'](`[${d.status.toUpperCase()}]`);
    term.white(`  Fuel: ${fuelPct}%  @ ${d.location_id}  ${eta}\n`);

    if (d.inventory?.length) {
      for (const item of d.inventory) {
        term.gray(`     Cargo: ${item.resource_id} × ${item.quantity_kg.toFixed(1)} kg\n`);
      }
    }
    term('\n');
  }

  renderLog();
}

// ─── Drone selector ───────────────────────────────────────────────────────────

async function showDroneSelector(drones) {
  clearContent(4);
  term.bold.white('  SELECT DRONE:\n\n');

  const labels = drones.map(
    (d) => `${d.name}  [${d.status}]  ${d.fuel_current_l.toFixed(1)}L  @ ${d.location_id}`
  );
  labels.push('← Back');

  const result = await term.singleColumnMenu(labels, {
    style: term.white,
    selectedStyle: term.bgBlue.white.bold,
    leftPadding: '  ',
  }).promise;

  renderLog();
  if (result.selectedText === '← Back') return null;
  return drones[result.selectedIndex];
}

// ─── Location selector ────────────────────────────────────────────────────────

async function showLocationSelector(locations, currentLocation) {
  clearContent(4);
  term.bold.white('  SELECT DESTINATION:\n\n');

  const origin = locations[currentLocation];
  const originCoords = origin?.coordinates ?? { x: 0, y: 0 };

  const locs = Object.values(locations)
    .filter((l) => l.id !== currentLocation)
    .map((l) => {
      const dx = (l.coordinates?.x ?? 0) - originCoords.x;
      const dy = (l.coordinates?.y ?? 0) - originCoords.y;
      return { ...l, distance: Math.round(Math.sqrt(dx * dx + dy * dy)) };
    })
    .sort((a, b) => a.distance - b.distance);

  const labels = locs.map((l) => `${l.name}  [${l.type}]  ${l.distance}u`);
  labels.push('← Back');

  const result = await term.singleColumnMenu(labels, {
    style: term.white,
    selectedStyle: term.bgMagenta.white.bold,
    leftPadding: '  ',
  }).promise;

  renderLog();
  if (result.selectedText === '← Back') return null;
  return locs[result.selectedIndex];
}

// ─── Scan results ─────────────────────────────────────────────────────────────

function renderScanResults(result, droneId) {
  clearContent(4);
  term.bold.cyan(`  ── SCAN RESULTS @ ${result.location} ──\n\n`);

  if (result.location_info) {
    term.white(`  Location: ${result.location_info.name} (${result.location_info.type})\n`);
    if (result.location_info.description) {
      term.gray(`  ${result.location_info.description}\n`);
    }
    term('\n');
  }

  term.bold.white('  Nearby Sites:\n');
  if (!result.nearby?.length) {
    term.white('  None detected in scan range.\n');
  } else {
    for (const loc of result.nearby) {
      term.white(`  ${loc.name} (${loc.type}) — ${loc.distance}u\n`);
    }
  }

  term('\n');
  term.bold.white('  Nearby Ships:\n');
  if (!result.ships.length) {
    term.white('  None detected.\n');
  } else {
    for (const ship of result.ships) {
      term.bold.white(`  ${ship.name}`);
      term.white(` (${ship.type_id})  `);
      term.cyan(`[${ship.status.toUpperCase()}]`);
      term.white(`  Owner: ${ship.owner_username}`);
      if (ship.owner_org) term.white(` · ${ship.owner_org}`);
      term('\n');
    }
  }

  if (droneId) renderDroneLog(droneId);
  else renderLog();
}

// ─── Command result ───────────────────────────────────────────────────────────

function renderCommandResult(title, lines, droneId) {
  clearContent(4);
  term.bold.cyan(`  ── ${title.toUpperCase()} ──\n\n`);
  for (const line of lines) {
    term.white(`  ${line}\n`);
  }

  if (droneId) renderDroneLog(droneId);
  else renderLog();
}

module.exports = {
  renderFleetTable,
  showDroneSelector,
  showLocationSelector,
  renderScanResults,
  renderCommandResult,
};
