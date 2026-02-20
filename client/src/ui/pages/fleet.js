'use strict';

const { term, clearContent, renderLog, renderDroneLog } = require('../layout');

const STATUS_COLOR = {
  idle: 'green',
  travelling: 'yellow',
  emergency: 'yellow',
  mining: 'cyan',
  returning: 'blue',
  offline: 'red',
};

const SCAN_REVEAL_MIN_MS = 140;
const SCAN_REVEAL_MAX_MS = 420;
const MENU_BOOT_BLINK_MS = 500;
const MENU_BOOT_TOGGLE_MS = 100;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
    if (d.status === 'emergency') {
      term.yellow(`     Battery: ${d.battery_remaining_sec ?? 0}s remaining\n`);
    }

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

function buildScanTargets(result) {
  const targets = [];

  if (result.location_info) {
    targets.push({
      id: `here:${result.location_info.id}`,
      kind: 'current_location',
      category: 'Current Location',
      label: `${result.location_info.name} (${result.location_info.type})`,
      menuLabel: `[CURRENT] ${result.location_info.name} (${result.location_info.type})`,
      data: { ...result.location_info, distance: 0 },
    });
  }

  for (const loc of result.nearby ?? []) {
    const category = siteCategory(loc.type);
    targets.push({
      id: `site:${loc.id}`,
      kind: 'site',
      category,
      label: `${loc.name} (${loc.type}) · ${loc.distance}u`,
      menuLabel: `[${category.toUpperCase()}] ${loc.name} (${loc.type}) · ${loc.distance}u`,
      data: loc,
    });
  }
  for (const ship of result.ships ?? []) {
    targets.push({
      id: `ship:${ship.id}`,
      kind: 'ship',
      category: 'Ships',
      label: `${ship.name} (${ship.type_id}) · ${ship.status}`,
      menuLabel: `[SHIPS] ${ship.name} (${ship.type_id}) · 0u · ${ship.status}`,
      data: { ...ship, distance: 0 },
    });
  }
  return sortTargetsByDistance(targets);
}

function siteCategory(type) {
  if (type === 'station' || type === 'outpost') return 'Stations';
  if (type === 'mining_zone') return 'Mining Fields';
  return 'Sites';
}

function categoryOrder(category) {
  if (category === 'Current Location') return 0;
  if (category === 'Ships') return 1;
  if (category === 'Stations') return 2;
  if (category === 'Mining Fields') return 3;
  return 4;
}

function groupedTargets(targets) {
  const groups = new Map();
  for (const target of targets) {
    const key = target.category ?? 'Sites';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(target);
  }
  return [...groups.entries()]
    .map(([category, rows]) => [category, sortTargetsByDistance(rows)])
    .sort((a, b) => categoryOrder(a[0]) - categoryOrder(b[0]));
}

function targetDistance(target) {
  const distance = target?.data?.distance;
  return Number.isFinite(distance) ? distance : Number.POSITIVE_INFINITY;
}

function sortTargetsByDistance(targets) {
  return [...targets].sort((a, b) => {
    const distanceDelta = targetDistance(a) - targetDistance(b);
    if (distanceDelta !== 0) return distanceDelta;
    return (a.label ?? '').localeCompare(b.label ?? '');
  });
}

function categoryColor(category) {
  if (category === 'Ships') return 'cyan';
  if (category === 'Stations') return 'green';
  if (category === 'Mining Fields') return 'yellow';
  if (category === 'Current Location') return 'white';
  return 'gray';
}

function renderTargetLine(target, prefix = '  - ', dim = false) {
  const color = categoryColor(target.category);
  if (dim) {
    term.gray(`${prefix}${target.menuLabel ?? target.label}\n`);
    return;
  }
  term[color](`${prefix}${target.menuLabel ?? target.label}\n`);
}

function randomRevealDelay() {
  return SCAN_REVEAL_MIN_MS + Math.floor(Math.random() * (SCAN_REVEAL_MAX_MS - SCAN_REVEAL_MIN_MS + 1));
}

function renderTargetDetail(target, location) {
  clearContent(4);
  term.bold.cyan('  ── TARGET DETAILS ──\n\n');
  term.white(`  Scan Origin: ${location}\n`);
  term.white(`  Type: ${target.category ?? target.kind.toUpperCase()}\n\n`);

  if (target.kind === 'site' || target.kind === 'current_location') {
    const site = target.data;
    term.bold.white(`  ${site.name}\n`);
    term.white(`  Category: ${site.type}\n`);
    term.white(`  Distance: ${site.distance}u\n`);
    if (site.description) term.gray(`  ${site.description}\n`);
  } else {
    const ship = target.data;
    term.bold.white(`  ${ship.name}\n`);
    term.white(`  Hull: ${ship.type_id}\n`);
    term.white(`  Status: ${ship.status}\n`);
    term.white(`  Owner: ${ship.owner_username}\n`);
    if (ship.owner_org) term.white(`  Organization: ${ship.owner_org}\n`);
  }
}

async function showTargetActionMenu(target) {
  const actions = target.kind === 'site' || target.kind === 'current_location'
    ? ['Contact', 'Market Interaction (Soon)', '← Back']
    : ['Contact', '← Back'];
  const result = await term.singleColumnMenu(actions, {
    style: term.white,
    selectedStyle: term.bgBlue.white.bold,
    leftPadding: '  ',
  }).promise;
  return result.selectedText;
}

async function handleTargetAction(target, action, droneId) {
  if (action === 'Contact') {
    const name = target.kind === 'site' ? target.data.name : target.data.name;
    const lines = target.kind === 'site'
      ? [`Opening channel to ${name}...`, 'No direct response received.', 'Diplomacy and market ops coming soon.']
      : [`Opening channel to ${name}...`, 'Handshake request sent.', 'Realtime interaction options coming soon.'];
    renderCommandResult('Contact', lines, droneId);
    await term.singleColumnMenu(['← Back'], { leftPadding: '  ' }).promise;
    return;
  }

  if (action === 'Market Interaction (Soon)') {
    renderCommandResult(
      'Market Interaction',
      ['Market interaction UI is planned for a follow-up update.'],
      droneId
    );
    await term.singleColumnMenu(['← Back'], { leftPadding: '  ' }).promise;
  }
}

async function runScanWorkflow(result, droneId) {
  const targets = buildScanTargets(result);
  const grouped = groupedTargets(targets);

  clearContent(4);
  term.bold.cyan(`  ── SCAN TARGETS @ ${result.location} ──\n\n`);
  term.gray('  Acquiring target telemetry...\n\n');
  term.bold.white('  Categories:\n');
  term.cyan('  Ships  ');
  term.green('Stations  ');
  term.yellow('Mining Fields  ');
  term.white('Current Location\n\n');
  term.bold.white('  Revealing targets (nearest first):\n');
  if (!targets.length) {
    term.gray('  - No targets detected\n');
  } else {
    for (const [category, rows] of grouped) {
      await wait(randomRevealDelay());
      term[categoryColor(category)](`  ${category}:\n`);
      for (const target of rows) {
        await wait(randomRevealDelay());
        renderTargetLine(target);
      }
    }
  }
  term('\n');

  const bootRow = Math.min(term.height - 1, 14 + targets.length);
  const blinkCycles = Math.max(1, Math.floor(MENU_BOOT_BLINK_MS / MENU_BOOT_TOGGLE_MS));
  for (let i = 0; i < blinkCycles; i += 1) {
    term.moveTo(1, bootRow);
    term.eraseLine();
    if (i % 2 === 0) term.bold.cyan('  Booting target menu...');
    await wait(MENU_BOOT_TOGGLE_MS);
  }
  term.moveTo(1, bootRow);
  term.eraseLine();

  if (droneId) renderDroneLog(droneId);
  else renderLog();

  while (true) {
    clearContent(4);
    term.bold.cyan(`  ── SCAN TARGETS @ ${result.location} ──\n\n`);
    const items = targets.map((t) => t.menuLabel ?? t.label);
    items.push('← Back');
    const menu = await term.singleColumnMenu(items, {
      style: term.white,
      selectedStyle: term.bgBlue.white.bold,
      leftPadding: '  ',
    }).promise;

    if (menu.selectedText === '← Back') break;
    const target = targets[menu.selectedIndex];
    if (!target) continue;

    while (true) {
      renderTargetDetail(target, result.location);
      if (droneId) renderDroneLog(droneId);
      else renderLog();
      const action = await showTargetActionMenu(target);
      if (action === '← Back') break;
      await handleTargetAction(target, action, droneId);
    }
  }
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
  runScanWorkflow,
  renderCommandResult,
};
