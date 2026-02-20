'use strict';

const { term, clearContent, renderLog, toggleLogSidebar, isLogSidebarEnabled } = require('../layout');

async function showSettingsMenu() {
  clearContent(4);
  term.bold.white('  SETTINGS\n\n');

  const items = [
    `System Log Sidebar: ${isLogSidebarEnabled() ? 'On' : 'Off'}`,
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

module.exports = { showSettingsMenu, toggleLogSidebar, isLogSidebarEnabled };
