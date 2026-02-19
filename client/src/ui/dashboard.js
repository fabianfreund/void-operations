'use strict';

/**
 * Main Dashboard — terminal-kit UI
 *
 * Layout:
 *   ┌──────────────────────────────────────────┐
 *   │  VOID OPERATIONS  ·  [username]  ·  credits │
 *   ├──────────────────────────────────────────┤
 *   │  [singleColumnMenu]                      │
 *   ├──────────────────────────────────────────┤
 *   │  Active task progressBar                 │
 *   ├──────────────────────────────────────────┤
 *   │  Scrolling system log                    │
 *   └──────────────────────────────────────────┘
 */

const term = require('terminal-kit').terminal;
const socket = require('../net/socket');
const world = require('../world');

const LOG_MAX = 50;
const log = [];
let currentMenu = null;
let progressInterval = null;
let activeDrone = null; // drone being tracked in the progress bar
let logSidebarEnabled = true;

const LOG_SIDEBAR_WIDTH = 40;

function contentWidth() {
  return logSidebarEnabled ? Math.max(40, term.width - LOG_SIDEBAR_WIDTH - 2) : term.width;
}

function clearContentArea(startRow = 3) {
  const width = contentWidth();
  for (let row = startRow; row <= term.height; row += 1) {
    term.moveTo(1, row);
    term.eraseLine();
    term(' '.repeat(width));
  }
}

// ─── Logging ──────────────────────────────────────────────────────────────────

function addLog(message, color = 'white', meta = {}) {
  const ts = new Date().toLocaleTimeString();
  log.unshift({ ts, message, color, ...meta });
  if (log.length > LOG_MAX) log.pop();
  renderLog();
}

function renderLogAt(startRow, filter = null) {
  if (logSidebarEnabled) {
    renderLogSidebar(filter);
    return;
  }

  const rows = term.height;
  const logStartRow = Math.max(3, Math.min(startRow, rows - 10));

  term.moveTo(1, logStartRow);
  term.eraseDisplayBelow();
  term.cyan('─'.repeat(term.width));
  term.moveTo(1, logStartRow + 1);
  term.bold.white('  SYSTEM LOG');

  const entries = filter ? log.filter(filter) : log;
  const visible = entries.slice(0, 8);
  for (let i = 0; i < 8; i += 1) {
    const row = logStartRow + 2 + i;
    term.moveTo(1, row);
    term.eraseLine();
    const entry = visible[i];
    if (entry) {
      term[entry.color](`  [${entry.ts}] ${entry.message}`);
    }
  }
}

function renderLog() {
  renderLogAt(term.height - 10);
}

function renderDroneLogAt(startRow, droneId) {
  renderLogAt(startRow, (entry) => entry.droneId === droneId);
}

function renderLogSidebar(filter = null) {
  if (!logSidebarEnabled) return;

  const leftWidth = contentWidth();
  const startCol = leftWidth + 2;
  const sidebarWidth = Math.max(12, term.width - startCol + 1);

  for (let row = 2; row <= term.height; row += 1) {
    term.moveTo(leftWidth + 1, row);
    term.gray('│');
    term.moveTo(startCol, row);
    term.eraseLine();
    term.gray(' '.repeat(sidebarWidth));
  }

  term.moveTo(startCol, 2);
  term.bold.white('SYSTEM LOG');

  const entries = filter ? log.filter(filter) : log;
  const maxRows = Math.max(1, term.height - 4);
  const lines = [];
  const lineWidth = Math.max(8, sidebarWidth - 2);

  for (const entry of entries) {
    const prefix = `[${entry.ts}] `;
    const text = `${prefix}${entry.message}`;
    for (let i = 0; i < text.length; i += lineWidth) {
      lines.push({ color: entry.color, text: text.slice(i, i + lineWidth) });
      if (lines.length >= maxRows) break;
    }
    if (lines.length >= maxRows) break;
  }

  for (let i = 0; i < lines.length; i += 1) {
    const row = 4 + i;
    if (row > term.height) break;
    term.moveTo(startCol, row);
    term.eraseLine();
    term[lines[i].color](lines[i].text);
  }
}

// ─── Header ───────────────────────────────────────────────────────────────────

function renderHeader(user) {
  term.clear();
  term.moveTo(1, 1);
  term.bgBlack.bold.cyan(' VOID OPERATIONS ');
  term.bold.white(` · ${user.username} · `);
  term.bold.yellow(`${user.credits.toFixed(0)} VOIDcredits`);
  if (user.org_name) {
    term.bold.white(` · ${user.org_name}`);
  }
  term('\n');
  term.cyan('═'.repeat(contentWidth()));
  renderLogSidebar();
}

// ─── Progress Bar ─────────────────────────────────────────────────────────────

function startProgressTracking(drone) {
  activeDrone = drone;
  stopProgressTracking();

  const barRow = term.height - 12;

  progressInterval = setInterval(() => {
    if (!activeDrone?.task_eta_at) return;

    const nowSec = Math.floor(Date.now() / 1000);
    const total = activeDrone.task_eta_at - activeDrone.task_started_at;
    const elapsed = nowSec - activeDrone.task_started_at;
    const pct = Math.min(1, Math.max(0, elapsed / total));
    const secLeft = Math.max(0, activeDrone.task_eta_at - nowSec);

    term.moveTo(1, barRow);
    term.eraseLine();
    term.bold.white(`  ${activeDrone.name} [${activeDrone.status.toUpperCase()}] `);
    term.bold.cyan(`ETA: ${secLeft}s\n`);

    term.moveTo(1, barRow + 1);
    term.progressBar({
      width: term.width - 4,
      percent: true,
      eta: false,
      filled: '█',
      empty: '░',
    }).update(pct);
  }, 1000);
}

function stopProgressTracking() {
  if (progressInterval) {
    clearInterval(progressInterval);
    progressInterval = null;
  }
}

// ─── Menus ────────────────────────────────────────────────────────────────────

async function showMainMenu(user) {
  renderHeader(user);

  const startRow = 4;
  term.moveTo(1, startRow);
  term.bold.white('  COMMAND DECK\n\n');

  const items = [
    'Administration',
    'View Fleet',
    'Status',
    'Quit',
  ];

  const result = await term.singleColumnMenu(items, {
    style: term.white,
    selectedStyle: term.bgCyan.black.bold,
    submittedStyle: term.bgGreen.white.bold,
    leftPadding: '  ',
  }).promise;

  renderLogAt(startRow + 2 + items.length);
  return result.selectedText;
}

async function showDroneSelector(drones) {
  const startRow = 4;
  term.moveTo(1, startRow);
  term.bold.white('  SELECT DRONE:\n\n');

  const labels = drones.map(
    (d) => `${d.name}  [${d.status}]  ${d.fuel_current_l.toFixed(1)}L fuel  @ ${d.location_id}`
  );
  labels.push('← Back');

  const result = await term.singleColumnMenu(labels, {
    style: term.white,
    selectedStyle: term.bgBlue.white.bold,
    leftPadding: '  ',
  }).promise;

  renderLogAt(startRow + 2 + labels.length);
  if (result.selectedText === '← Back') return null;
  return drones[result.selectedIndex];
}

async function showLocationSelector(locations, currentLocation) {
  const startRow = 12;
  term.moveTo(1, startRow);
  term.bold.white('  SELECT DESTINATION:\n\n');

  const origin = locations[currentLocation];
  const originCoords = origin?.coordinates ?? { x: 0, y: 0 };
  const locs = Object.values(locations)
    .filter((l) => l.id !== currentLocation)
    .map((l) => {
      const dx = (l.coordinates?.x ?? 0) - originCoords.x;
      const dy = (l.coordinates?.y ?? 0) - originCoords.y;
      const distance = Math.round(Math.sqrt(dx * dx + dy * dy));
      return { ...l, distance };
    })
    .sort((a, b) => a.distance - b.distance);
  const labels = locs.map((l) => `${l.name}  [${l.type}]  ${l.distance}u`);
  labels.push('← Back');

  const result = await term.singleColumnMenu(labels, {
    style: term.white,
    selectedStyle: term.bgMagenta.white.bold,
    leftPadding: '  ',
  }).promise;

  renderLogAt(startRow + 2 + labels.length);
  if (result.selectedText === '← Back') return null;
  return locs[result.selectedIndex];
}

// ─── Fleet display ────────────────────────────────────────────────────────────

function renderFleetTable(drones) {
  term.moveTo(1, 4);
  term.eraseDisplayBelow();
  term.bold.cyan('  ── FLEET STATUS ──\n\n');

  if (!drones.length) {
    term.white('  No drones registered.\n');
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

    const statusColor = { idle: 'green', travelling: 'yellow', mining: 'cyan', returning: 'blue', offline: 'red' };
    term[statusColor[d.status] ?? 'white'](`[${d.status.toUpperCase()}]`);
    term.white(`  Fuel: ${fuelPct}%  Location: ${d.location_id}  ${eta}\n`);

    if (d.inventory?.length) {
      for (const item of d.inventory) {
        term.gray(`     Cargo: ${item.resource_id} × ${item.quantity_kg.toFixed(1)} kg\n`);
      }
    }
    term('\n');
  }

  renderLog();
}

async function showDroneActionMenu(drone) {
  const startRow = 4;
  term.moveTo(1, startRow);
  term.eraseDisplayBelow();
  term.bold.white(`  DRONE: ${drone.name}\n`);
  term('\n');

  const items = [
    'Status',
    'Commands',
    'Scan',
    '← Back',
  ];
  const result = await term.singleColumnMenu(items, {
    style: term.white,
    selectedStyle: term.bgBlue.white.bold,
    leftPadding: '  ',
  }).promise;

  renderDroneLogAt(startRow + 2 + items.length, drone.id);
  return result.selectedText;
}

async function showDroneCommandMenu(drone) {
  const startRow = 4;
  term.moveTo(1, startRow);
  term.eraseDisplayBelow();
  term.bold.white(`  COMMANDS: ${drone.name}\n`);
  term('\n');

  const items = [
    'Travel',
    'Mine',
    'Sell Cargo',
    'Refuel',
    '← Back',
  ];

  const result = await term.singleColumnMenu(items, {
    style: term.white,
    selectedStyle: term.bgBlue.white.bold,
    leftPadding: '  ',
  }).promise;

  renderDroneLogAt(startRow + 2 + items.length, drone.id);
  return result.selectedText;
}

function renderDroneDetail(drone) {
  term.moveTo(1, 4);
  term.eraseDisplayBelow();
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
      const fuelCost = drone.spec
        ? distance * drone.spec.fuel_burn_rate_l_per_km
        : null;
      term.white(`  Destination: ${drone.destination_id}\n`);
      term.white(`  Distance: ${distance}u\n`);
      if (fuelCost !== null) {
        term.white(`  Fuel Cost (est): ${fuelCost.toFixed(1)}L\n`);
      }
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

  renderDroneLogAt(term.height - 10, drone.id);
}

function renderScanResults(result, droneId) {
  term.moveTo(1, 4);
  term.eraseDisplayBelow();
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
    return;
  }

  for (const ship of result.ships) {
    term.bold.white(`  ${ship.name}`);
    term.white(` (${ship.type_id})  `);
    term.cyan(`[${ship.status.toUpperCase()}]`);
    term.white(`  Owner: ${ship.owner_username}`);
    if (ship.owner_org) term.white(` · ${ship.owner_org}`);
    term('\n');
  }

  if (droneId) renderDroneLogAt(term.height - 10, droneId);
  else renderLog();
}

function renderCommandResult(title, lines, droneId) {
  term.moveTo(1, 4);
  term.eraseDisplayBelow();
  term.bold.cyan(`  ── ${title.toUpperCase()} ──\n\n`);
  for (const line of lines) {
    term.white(`  ${line}\n`);
  }

  if (droneId) renderDroneLogAt(term.height - 10, droneId);
  else renderLog();
}

async function showAdminMenu(user) {
  renderHeader(user);
  const startRow = 4;
  term.moveTo(1, startRow);
  term.bold.white('  ADMINISTRATION\n\n');
  term.white(`  User: ${user.username}\n`);
  term.white(`  Organization: ${user.org_name ?? 'Unassigned'}\n\n`);

  const items = [
    'Set Organization',
    'List Organizations',
    'List Players',
    'Settings',
    '← Back',
  ];

  const result = await term.singleColumnMenu(items, {
    style: term.white,
    selectedStyle: term.bgMagenta.white.bold,
    leftPadding: '  ',
  }).promise;

  renderLogAt(startRow + 6 + items.length);
  return result.selectedText;
}

async function showSettingsMenu() {
  const startRow = 4;
  term.moveTo(1, startRow);
  term.eraseDisplayBelow();
  term.bold.white('  SETTINGS\n\n');

  const items = [
    `System Log Sidebar: ${logSidebarEnabled ? 'On' : 'Off'}`,
    '← Back',
  ];

  const result = await term.singleColumnMenu(items, {
    style: term.white,
    selectedStyle: term.bgMagenta.white.bold,
    leftPadding: '  ',
  }).promise;

  renderLogAt(startRow + 4 + items.length);
  return result.selectedIndex;
}

function toggleLogSidebar() {
  logSidebarEnabled = !logSidebarEnabled;
}

function isLogSidebarEnabled() {
  return logSidebarEnabled;
}

async function promptOrganizationName(currentName) {
  term('\n');
  term.bold.white('Organization Name: ');
  const name = (await term.inputField({
    cancelable: true,
    default: currentName ?? '',
  }).promise) ?? '';
  term('\n');
  return name.trim();
}

function renderOrganizations(orgs) {
  term.moveTo(1, 4);
  clearContentArea(4);
  term.bold.cyan('  ── ORGANIZATIONS ──\n\n');

  if (!orgs.length) {
    term.white('  No organizations registered.\n');
    renderLog();
    return;
  }

  for (const org of orgs) {
    term.white(`  ${org.org_name}  (${org.members} members)\n`);
  }

  renderLog();
}

function renderPlayers(players) {
  term.moveTo(1, 4);
  clearContentArea(4);
  term.bold.cyan('  ── PLAYERS ──\n\n');

  if (!players.length) {
    term.white('  No players registered.\n');
    renderLog();
    return;
  }

  for (const p of players) {
    const org = p.org_name ? ` · ${p.org_name}` : '';
    term.white(`  ${p.username}${org}\n`);
  }

  renderLog();
}

function renderOverallStatus(user, drones) {
  term.moveTo(1, 4);
  clearContentArea(4);
  term.bold.cyan('  ── OVERALL STATUS ──\n\n');

  term.bold.white(`  Commander: ${user.username}\n`);
  term.white(`  Organization: ${user.org_name ?? 'Unassigned'}\n`);
  term.white(`  Credits: ${user.credits.toFixed(0)} VOIDcredits\n\n`);

  const totals = { idle: 0, travelling: 0, mining: 0, returning: 0, other: 0 };
  for (const d of drones) {
    if (totals[d.status] !== undefined) totals[d.status] += 1;
    else totals.other += 1;
  }

  term.bold.white('  Fleet Summary:\n');
  term.white(`  Total drones: ${drones.length}\n`);
  term.green(`  Idle: ${totals.idle}\n`);
  term.yellow(`  Travelling: ${totals.travelling}\n`);
  term.cyan(`  Mining: ${totals.mining}\n`);
  term.blue(`  Returning: ${totals.returning}\n`);
  if (totals.other) term.white(`  Other: ${totals.other}\n`);

  const active = drones.find((d) => d.status !== 'idle');
  if (active) {
    term('\n');
    term.bold.white('  Active Task:\n');
    term.white(`  ${active.name} [${active.status.toUpperCase()}] @ ${active.location_id}\n`);
  }

  term('\n');
  term.bold.white('  Drone Positions:\n');
  if (!drones.length) {
    term.white('  No drones registered.\n');
    return;
  }

  for (const d of drones) {
    term.white(`  ${d.name} [${d.status.toUpperCase()}] @ ${d.location_id}\n`);
  }

  renderLog();
}

async function waitForBack(prompt = '← Back') {
  const row = Math.max(2, term.height - 1);
  term.moveTo(1, row);
  term.eraseLine();
  term.bold.white(`  ${prompt}`);

  return new Promise((resolve) => {
    const onKey = (name) => {
      if (name === 'ENTER' || name === 'ESCAPE') {
        term.off('key', onKey);
        resolve();
      }
    };
    term.on('key', onKey);
  });
}

// ─── Module exports ───────────────────────────────────────────────────────────

module.exports = {
  addLog,
  renderHeader,
  showMainMenu,
  renderOverallStatus,
  showAdminMenu,
  showSettingsMenu,
  toggleLogSidebar,
  isLogSidebarEnabled,
  promptOrganizationName,
  renderOrganizations,
  renderPlayers,
  showDroneSelector,
  showLocationSelector,
  showDroneActionMenu,
  showDroneCommandMenu,
  renderDroneDetail,
  renderScanResults,
  renderCommandResult,
  renderFleetTable,
  waitForBack,
  startProgressTracking,
  stopProgressTracking,
};
