'use strict';

const { term, clearContent, renderLog, renderHeader } = require('../layout');

const ITEMS = ['Administration', 'View Fleet', 'Status', 'Quit'];

async function showMainMenu(user) {
  renderHeader(user);
  clearContent(4);
  term.bold.white('  COMMAND DECK\n\n');

  const result = await term.singleColumnMenu(ITEMS, {
    style: term.white,
    selectedStyle: term.bgCyan.black.bold,
    submittedStyle: term.bgGreen.white.bold,
    leftPadding: '  ',
  }).promise;

  renderLog();
  return result.selectedText;
}

module.exports = { showMainMenu };
