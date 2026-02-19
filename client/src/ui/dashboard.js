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

const LOG_MAX = 50;
const log = [];
let currentMenu = null;
let progressInterval = null;
let activeDrone = null; // drone being tracked in the progress bar

// ─── Logging ──────────────────────────────────────────────────────────────────

function addLog(message, color = 'white') {
  const ts = new Date().toLocaleTimeString();
  log.unshift({ ts, message, color });
  if (log.length > LOG_MAX) log.pop();
  renderLog();
}

function renderLog() {
  const rows = term.height;
  const logStartRow = rows - 10;

  term.moveTo(1, logStartRow);
  term.eraseDisplayBelow();
  term.cyan('─'.repeat(term.width));
  term.moveTo(1, logStartRow + 1);
  term.bold.white('  SYSTEM LOG\n');

  const visible = log.slice(0, 8);
  for (const entry of visible) {
    term.moveTo(1, term.getCursorLocation?.()?.y ?? logStartRow + 2);
    term[entry.color](`  [${entry.ts}] ${entry.message}\n`);
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
  term.cyan('═'.repeat(term.width));
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
  addLog('Welcome back, commander.');

  term.moveTo(1, 4);
  term.bold.white('  COMMAND DECK\n\n');

  const items = [
    'View Fleet',
    'Travel',
    'Mine',
    'Sell Cargo',
    'Refuel',
    'Refresh Status',
    'Administration',
    'Quit',
  ];

  const result = await term.singleColumnMenu(items, {
    style: term.white,
    selectedStyle: term.bgCyan.black.bold,
    submittedStyle: term.bgGreen.white.bold,
    leftPadding: '  ',
  }).promise;

  return result.selectedText;
}

async function showDroneSelector(drones) {
  term.moveTo(1, 12);
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

  if (result.selectedText === '← Back') return null;
  return drones[result.selectedIndex];
}

async function showLocationSelector(locations, currentLocation) {
  term.moveTo(1, 12);
  term.bold.white('  SELECT DESTINATION:\n\n');

  const locs = Object.values(locations).filter((l) => l.id !== currentLocation);
  const labels = locs.map((l) => `${l.name}  [${l.type}]`);
  labels.push('← Back');

  const result = await term.singleColumnMenu(labels, {
    style: term.white,
    selectedStyle: term.bgMagenta.white.bold,
    leftPadding: '  ',
  }).promise;

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

    const statusColor = { idle: 'green', travelling: 'yellow', mining: 'cyan', returning: 'blue' };
    term[statusColor[d.status] ?? 'white'](`[${d.status.toUpperCase()}]`);
    term.white(`  Fuel: ${fuelPct}%  Location: ${d.location_id}  ${eta}\n`);

    if (d.inventory?.length) {
      for (const item of d.inventory) {
        term.gray(`     Cargo: ${item.resource_id} × ${item.quantity_kg.toFixed(1)} kg\n`);
      }
    }
    term('\n');
  }
}

async function showDroneActionMenu(drone) {
  term.moveTo(1, 12);
  term.eraseDisplayBelow();
  term.bold.white(`  DRONE: ${drone.name}\n\n`);

  const items = ['Status', 'Scan Nearby Ships', '← Back'];
  const result = await term.singleColumnMenu(items, {
    style: term.white,
    selectedStyle: term.bgBlue.white.bold,
    leftPadding: '  ',
  }).promise;

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
}

function renderScanResults(result) {
  term.moveTo(1, 4);
  term.eraseDisplayBelow();
  term.bold.cyan(`  ── SCAN RESULTS @ ${result.location} ──\n\n`);

  if (!result.ships.length) {
    term.white('  No nearby ships detected.\n');
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
}

async function showAdminMenu(user) {
  renderHeader(user);
  term.moveTo(1, 4);
  term.bold.white('  ADMINISTRATION\n\n');
  term.white(`  User: ${user.username}\n`);
  term.white(`  Organization: ${user.org_name ?? 'Unassigned'}\n\n`);

  const items = [
    'Set Organization',
    'List Organizations',
    'List Players',
    '← Back',
  ];

  const result = await term.singleColumnMenu(items, {
    style: term.white,
    selectedStyle: term.bgMagenta.white.bold,
    leftPadding: '  ',
  }).promise;

  return result.selectedText;
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
  term.eraseDisplayBelow();
  term.bold.cyan('  ── ORGANIZATIONS ──\n\n');

  if (!orgs.length) {
    term.white('  No organizations registered.\n');
    return;
  }

  for (const org of orgs) {
    term.white(`  ${org.org_name}  (${org.members} members)\n`);
  }
}

function renderPlayers(players) {
  term.moveTo(1, 4);
  term.eraseDisplayBelow();
  term.bold.cyan('  ── PLAYERS ──\n\n');

  if (!players.length) {
    term.white('  No players registered.\n');
    return;
  }

  for (const p of players) {
    const org = p.org_name ? ` · ${p.org_name}` : '';
    term.white(`  ${p.username}${org}\n`);
  }
}

// ─── Module exports ───────────────────────────────────────────────────────────

module.exports = {
  addLog,
  renderHeader,
  showMainMenu,
  showAdminMenu,
  promptOrganizationName,
  renderOrganizations,
  renderPlayers,
  showDroneSelector,
  showLocationSelector,
  showDroneActionMenu,
  renderDroneDetail,
  renderScanResults,
  renderFleetTable,
  startProgressTracking,
  stopProgressTracking,
};
