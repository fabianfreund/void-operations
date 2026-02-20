'use strict';

const {
  term,
  clearContent,
  renderLog,
  toggleLogSidebar,
  isLogSidebarEnabled,
  getInfoPanelMode,
  getPinnedFields,
  setPinnedFields,
} = require('../layout');

const ALL_FIELDS = ['status', 'fuel', 'battery', 'eta', 'cargo'];

async function showSettingsMenu() {
  clearContent(4);
  term.bold.white('  SETTINGS\n\n');

  const items = [
    `System Log Sidebar: ${isLogSidebarEnabled() ? 'On' : 'Off'}`,
    `Info Panel: ${_modeLabel(getInfoPanelMode())}`,
    'Pinned Fields…',
    '← Back',
  ];

  const result = await term.singleColumnMenu(items, {
    style: term.white,
    selectedStyle: term.bgMagenta.white.bold,
    leftPadding: '  ',
  }).promise;

  renderLog();
  return result.selectedIndex;
}

/** Show the Info Panel mode selector. Returns selected index. */
async function showInfoPanelMenu() {
  clearContent(4);
  term.bold.white('  INFO PANEL MODE\n\n');

  const items = ['Off', 'Fleet Status', 'Pinned Drones', '← Back'];

  const result = await term.singleColumnMenu(items, {
    style: term.white,
    selectedStyle: term.bgMagenta.white.bold,
    leftPadding: '  ',
  }).promise;

  renderLog();
  return result.selectedIndex;
}

/**
 * Show the Pinned Fields toggle menu. Loops until Back is selected.
 * Calls setPinnedFields internally so the caller just awaits this function.
 */
async function showPinnedFieldsMenu() {
  while (true) {
    const current = getPinnedFields();
    clearContent(4);
    term.bold.white('  PINNED FIELDS\n\n');
    term.gray('  Toggle which fields appear for pinned drones.\n\n');

    const items = ALL_FIELDS.map(
      (f) => `${current.includes(f) ? '[✓]' : '[ ]'} ${_fieldLabel(f)}`
    );
    items.push('← Back');

    const result = await term.singleColumnMenu(items, {
      style: term.white,
      selectedStyle: term.bgMagenta.white.bold,
      leftPadding: '  ',
    }).promise;

    renderLog();
    if (result.selectedText === '← Back') break;

    const field = ALL_FIELDS[result.selectedIndex];
    if (!field) break;

    const fields = getPinnedFields();
    const idx = fields.indexOf(field);
    if (idx >= 0) {
      fields.splice(idx, 1);
    } else {
      fields.push(field);
    }
    setPinnedFields(fields);
  }
}

function _modeLabel(mode) {
  if (mode === 'fleet') return 'Fleet Status';
  if (mode === 'pinned') return 'Pinned Drones';
  return 'Off';
}

function _fieldLabel(field) {
  const labels = { status: 'Status', fuel: 'Fuel', battery: 'Battery', eta: 'ETA', cargo: 'Cargo' };
  return labels[field] ?? field;
}

module.exports = {
  showSettingsMenu,
  showInfoPanelMenu,
  showPinnedFieldsMenu,
  toggleLogSidebar,
  isLogSidebarEnabled,
};
