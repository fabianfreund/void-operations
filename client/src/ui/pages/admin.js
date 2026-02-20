'use strict';

const { term, clearContent, renderLog, renderHeader } = require('../layout');

// ─── Admin menu ───────────────────────────────────────────────────────────────

async function showAdminMenu(user) {
  renderHeader(user);
  clearContent(4);
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

  renderLog();
  return result.selectedText;
}

// ─── Organizations ────────────────────────────────────────────────────────────

function renderOrganizations(orgs) {
  clearContent(4);
  term.bold.cyan('  ── ORGANIZATIONS ──\n\n');

  if (!orgs.length) {
    term.white('  No organizations registered.\n');
  } else {
    for (const org of orgs) {
      term.white(`  ${org.org_name}  (${org.members} members)\n`);
    }
  }

  renderLog();
}

// ─── Players ──────────────────────────────────────────────────────────────────

function renderPlayers(players) {
  clearContent(4);
  term.bold.cyan('  ── PLAYERS ──\n\n');

  if (!players.length) {
    term.white('  No players registered.\n');
  } else {
    for (const p of players) {
      const org = p.org_name ? ` · ${p.org_name}` : '';
      term.white(`  ${p.username}${org}\n`);
    }
  }

  renderLog();
}

// ─── Org name prompt ──────────────────────────────────────────────────────────

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

module.exports = {
  showAdminMenu,
  renderOrganizations,
  renderPlayers,
  promptOrganizationName,
};
