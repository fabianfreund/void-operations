'use strict';

/**
 * layout.js — core terminal layout primitives
 *
 * Owns: term singleton, log state, sidebar, header, progress bar, info panel.
 * All page modules import from here — never from terminal-kit directly.
 */

const term = require('terminal-kit').terminal;

const LOG_MAX = 50;
const LOG_SIDEBAR_WIDTH = 40;
const MIN_CONTENT_WIDTH = 36;
const MIN_SIDEBAR_WIDTH = 18;

const log = [];
let progressInterval = null;
let activeDrone = null;
let activeProgressBar = null;
let logSidebarEnabled = true;

// ─── Info panel state ─────────────────────────────────────────────────────────

let infoPanelMode = 'off'; // 'off' | 'fleet' | 'pinned'
let cachedDrones = [];
const pinnedDroneIds = new Set();
let pinnedFields = ['status', 'fuel']; // options: 'status','fuel','battery','eta','cargo'

const PANEL_HEIGHT = 8;
function PANEL_TOP() {
  return Math.max(14, term.height - 20);
}

const STATUS_COLOR = {
  idle: 'green',
  travelling: 'yellow',
  emergency: 'yellow',
  mining: 'cyan',
  returning: 'blue',
  offline: 'red',
};

// ─── Dimensions ───────────────────────────────────────────────────────────────

function contentWidth() {
  return getLayoutDimensions().leftWidth;
}

function getLayoutDimensions() {
  if (!logSidebarEnabled) {
    return {
      showSidebar: false,
      leftWidth: term.width,
      sidebarWidth: 0,
      startCol: term.width + 1,
    };
  }

  const maxSidebarThatFits = term.width - MIN_CONTENT_WIDTH - 1;
  if (maxSidebarThatFits < MIN_SIDEBAR_WIDTH) {
    return {
      showSidebar: false,
      leftWidth: term.width,
      sidebarWidth: 0,
      startCol: term.width + 1,
    };
  }

  const sidebarWidth = Math.min(LOG_SIDEBAR_WIDTH, maxSidebarThatFits);
  const leftWidth = term.width - sidebarWidth - 1;
  const startCol = leftWidth + 2;
  return { showSidebar: true, leftWidth, sidebarWidth, startCol };
}

/**
 * Clear the left content area (rows startRow..bottom) and reset the cursor
 * back to (1, startRow) so callers can write content immediately after.
 */
function clearContent(startRow = 4) {
  const width = contentWidth();
  const safeWidth = Math.max(0, width - 1);
  for (let row = startRow; row <= term.height; row += 1) {
    term.moveTo(1, row);
    if (safeWidth) term(' '.repeat(safeWidth));
  }
  term.moveTo(1, startRow);
}

// ─── Logging ──────────────────────────────────────────────────────────────────

function addLog(message, color = 'white', meta = {}) {
  const ts = new Date().toLocaleTimeString();
  log.unshift({ ts, message, color, ...meta });
  if (log.length > LOG_MAX) log.pop();
  renderLogSidebar();
}

function renderLogSidebar(filter = null) {
  const dims = getLayoutDimensions();
  if (!dims.showSidebar) return;

  const leftWidth = dims.leftWidth;
  const startCol = dims.startCol;
  const sidebarWidth = dims.sidebarWidth;
  const lineWidth = Math.max(8, sidebarWidth - 2);

  // Draw divider column
  for (let row = 2; row <= term.height; row += 1) {
    term.moveTo(leftWidth + 1, row);
    term.gray('│');
  }

  // Header
  term.moveTo(startCol, 2);
  term.bold.white('SYSTEM LOG');

  // Build wrapped lines
  const entries = filter ? log.filter(filter) : log;
  const maxRows = Math.max(1, term.height - 4);
  const lines = [];
  for (const entry of entries) {
    const text = `[${entry.ts}] ${entry.message}`;
    for (let i = 0; i < text.length; i += lineWidth) {
      lines.push({ color: entry.color, text: text.slice(i, i + lineWidth) });
      if (lines.length >= maxRows) break;
    }
    if (lines.length >= maxRows) break;
  }

  // Paint sidebar rows (clear + text)
  for (let i = 0; i < maxRows; i += 1) {
    const row = 4 + i;
    if (row > term.height) break;
    term.moveTo(startCol, row);
    term.eraseLineAfter();
    if (lines[i]) {
      term.moveTo(startCol, row);
      term[lines[i].color](lines[i].text);
    }
  }
}

/** Re-render the log (sidebar or no-op when sidebar is off). */
function renderLog() {
  renderLogSidebar();
}

/** Re-render the log filtered to a specific drone. */
function renderDroneLog(droneId) {
  renderLogSidebar((e) => e.droneId === droneId);
}

// ─── Header ───────────────────────────────────────────────────────────────────

function renderHeader(user) {
  term.clear();
  term.moveTo(1, 1);
  term.bgBlack.bold.cyan(' VOID OPERATIONS ');
  term.bold.white(` · ${user.username} · `);
  term.bold.yellow(`${user.credits.toFixed(0)} VOIDcredits`);
  if (user.org_name) term.bold.white(` · ${user.org_name}`);
  term('\n');
  term.cyan('═'.repeat(contentWidth()));
  renderLogSidebar();
  renderInfoPanel();
}

// ─── Progress bar ─────────────────────────────────────────────────────────────

function startProgressTracking(drone) {
  stopProgressTracking();
  activeDrone = drone;

  const barRow = term.height - 12;
  const barWidth = Math.max(12, contentWidth() - 4);

  term.moveTo(1, barRow);
  term.eraseLine();
  term.moveTo(1, barRow + 1);
  term.eraseLine();

  activeProgressBar = term.progressBar({
    width: barWidth,
    percent: true,
    eta: false,
    filled: '█',
    empty: '░',
    x: 1,
    y: barRow + 1,
  });

  const renderTick = () => {
    if (!activeDrone?.task_eta_at || !activeDrone?.task_started_at) return;

    const nowSec = Math.floor(Date.now() / 1000);
    const total = Math.max(1, activeDrone.task_eta_at - activeDrone.task_started_at);
    const elapsed = Math.max(0, nowSec - activeDrone.task_started_at);
    const pct = Math.min(1, Math.max(0, elapsed / total));
    const secLeft = Math.max(0, activeDrone.task_eta_at - nowSec);

    term.moveTo(1, barRow);
    term.eraseLine();
    term.bold.white(`  ${activeDrone.name} [${activeDrone.status.toUpperCase()}] `);
    term.bold.cyan(`ETA: ${secLeft}s`);

    activeProgressBar.update(pct);
  };

  renderTick();
  progressInterval = setInterval(renderTick, 1000);
}

function stopProgressTracking() {
  if (progressInterval) {
    clearInterval(progressInterval);
    progressInterval = null;
  }
  const barRow = term.height - 12;
  term.moveTo(1, barRow);
  term.eraseLine();
  term.moveTo(1, barRow + 1);
  term.eraseLine();
  activeProgressBar = null;
  activeDrone = null;
}

// ─── Navigation ───────────────────────────────────────────────────────────────

/** Blocks until ENTER or ESC, showing a back prompt at the bottom. */
function waitForBack() {
  const row = term.height - 1;
  term.moveTo(1, row);
  term.bold.white('  ← Back  (ENTER or ESC)');

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

// ─── Sidebar toggle ───────────────────────────────────────────────────────────

function toggleLogSidebar() {
  logSidebarEnabled = !logSidebarEnabled;
}

function isLogSidebarEnabled() {
  return logSidebarEnabled;
}

// ─── Info panel ───────────────────────────────────────────────────────────────

function setCachedDrones(drones) {
  cachedDrones = drones;
  renderInfoPanel();
}

function setInfoPanelMode(mode) {
  const normalized = mode === 'fleet' || mode === 'pinned' ? mode : 'off';
  infoPanelMode = normalized;
  renderInfoPanel();
}

function setPinnedFields(fields) {
  pinnedFields = fields;
  renderInfoPanel();
}

/** Toggles a drone in/out of the pinned set. Returns new pinned state. */
function togglePinnedDrone(droneId) {
  if (pinnedDroneIds.has(droneId)) {
    pinnedDroneIds.delete(droneId);
  } else {
    pinnedDroneIds.add(droneId);
  }
  renderInfoPanel();
  return pinnedDroneIds.has(droneId);
}

function isPinned(droneId) {
  return pinnedDroneIds.has(droneId);
}

function getInfoPanelMode() {
  return infoPanelMode;
}

function getPinnedFields() {
  return pinnedFields.slice();
}

function renderInfoPanel() {
  const panelTop = PANEL_TOP();
  const width = contentWidth();
  const safeWidth = Math.max(0, width - 1);

  // Clear divider row + panel area
  for (let row = panelTop - 1; row < panelTop + PANEL_HEIGHT; row += 1) {
    if (row < 1 || row > term.height) continue;
    term.moveTo(1, row);
    if (safeWidth) term(' '.repeat(safeWidth));
  }

  if (infoPanelMode === 'off') return;

  // Draw thin divider
  term.moveTo(1, panelTop - 1);
  term.gray('─'.repeat(width));

  const drones =
    infoPanelMode === 'pinned'
      ? cachedDrones.filter((d) => pinnedDroneIds.has(d.id))
      : cachedDrones;

  if (!drones.length) {
    term.moveTo(1, panelTop);
    const label = infoPanelMode === 'pinned' ? 'No pinned drones.' : 'No drones.';
    term.gray(`  ${label}`);
    return;
  }

  const maxRow = panelTop + PANEL_HEIGHT - 1;
  let row = panelTop;

  for (const d of drones) {
    if (row > maxRow) break;

    const fuelPct = d.spec
      ? Math.round((d.fuel_current_l / d.spec.fuel_tank_l) * 100)
      : '?';

    term.moveTo(1, row);
    term.bold.white(`  ${d.name.padEnd(12)}`);
    term[STATUS_COLOR[d.status] ?? 'white'](`[${d.status.toUpperCase().padEnd(10)}]`);

    const parts = [];
    if (infoPanelMode === 'fleet') {
      parts.push(`Fuel:${fuelPct}%`);
      if (d.task_eta_at) {
        const sec = Math.max(0, d.task_eta_at - Math.floor(Date.now() / 1000));
        parts.push(`ETA:${sec}s`);
      }
    } else {
      // pinned mode — show only selected fields
      if (pinnedFields.includes('fuel')) parts.push(`Fuel:${fuelPct}%`);
      if (pinnedFields.includes('battery') && d.status === 'emergency') {
        const sec = d.battery_remaining_sec ?? 0;
        parts.push(`Battery:${sec}s`);
      }
      if (pinnedFields.includes('eta') && d.task_eta_at) {
        const sec = Math.max(0, d.task_eta_at - Math.floor(Date.now() / 1000));
        parts.push(`ETA:${sec}s`);
      }
      if (pinnedFields.includes('cargo') && d.inventory?.length) {
        const total = d.inventory.reduce((s, i) => s + i.quantity_kg, 0);
        parts.push(`Cargo:${total.toFixed(0)}kg`);
      }
    }
    if (parts.length) term.white(`  ${parts.join('  ')}`);

    row += 1;
  }
}

// ─── Menu helpers ─────────────────────────────────────────────────────────────

/**
 * Render a singleColumnMenu starting at the given row.
 * Returns the selected text.
 */
async function showMenu(items, startRow, style = {}) {
  term.moveTo(1, startRow);
  const result = await term.singleColumnMenu(items, {
    style: term.white,
    selectedStyle: term.bgCyan.black.bold,
    leftPadding: '  ',
    ...style,
  }).promise;
  return result;
}

module.exports = {
  term,
  contentWidth,
  clearContent,
  addLog,
  renderLog,
  renderLogSidebar,
  renderDroneLog,
  renderHeader,
  startProgressTracking,
  stopProgressTracking,
  waitForBack,
  toggleLogSidebar,
  isLogSidebarEnabled,
  showMenu,
  // info panel
  setCachedDrones,
  setInfoPanelMode,
  setPinnedFields,
  togglePinnedDrone,
  isPinned,
  getInfoPanelMode,
  getPinnedFields,
  renderInfoPanel,
};
