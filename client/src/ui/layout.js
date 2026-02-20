'use strict';

/**
 * layout.js — core terminal layout primitives
 *
 * Owns: term singleton, log state, sidebar, header, progress bar.
 * All page modules import from here — never from terminal-kit directly.
 */

const term = require('terminal-kit').terminal;

const LOG_MAX = 50;
const LOG_SIDEBAR_WIDTH = 40;

const log = [];
let progressInterval = null;
let activeDrone = null;
let logSidebarEnabled = true;

// ─── Dimensions ───────────────────────────────────────────────────────────────

function contentWidth() {
  return logSidebarEnabled ? Math.max(40, term.width - LOG_SIDEBAR_WIDTH - 2) : term.width;
}

/**
 * Clear the left content area (rows startRow..bottom) and reset the cursor
 * back to (1, startRow) so callers can write content immediately after.
 */
function clearContent(startRow = 4) {
  const width = contentWidth();
  for (let row = startRow; row <= term.height; row += 1) {
    term.moveTo(1, row);
    term(' '.repeat(width));
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
  if (!logSidebarEnabled) return;

  const leftWidth = contentWidth();
  const startCol = leftWidth + 2;
  const sidebarWidth = Math.max(12, term.width - startCol + 1);
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
    term(' '.repeat(sidebarWidth));
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
}

// ─── Progress bar ─────────────────────────────────────────────────────────────

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
      width: contentWidth() - 4,
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
};
