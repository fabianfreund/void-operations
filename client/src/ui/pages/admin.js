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
    'Reset Player',
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
      term.white(`  ${p.username}${org} · ${Math.round(p.credits)}cr\n`);
    }
  }

  renderLog();
}

async function showPlayerResetMenu(players) {
  clearContent(4);
  term.bold.cyan('  ── RESET PLAYER ──\n\n');
  term.gray('  Select a player to reset immediately.\n\n');

  const items = players.map((p) => {
    const org = p.org_name ? ` · ${p.org_name}` : '';
    return `${p.username}${org} · ${Math.round(p.credits)}cr`;
  });
  items.push('← Back');

  const result = await term.singleColumnMenu(items, {
    style: term.white,
    selectedStyle: term.bgRed.white.bold,
    leftPadding: '  ',
  }).promise;

  renderLog();
  if (result.selectedText === '← Back') return null;
  return players[result.selectedIndex] ?? null;
}

// ─── Org name prompt ──────────────────────────────────────────────────────────

async function promptOrganizationName(currentName) {
  clearContent(4);
  term.moveTo(1, 4);
  term.bold.cyan('  ── SET ORGANIZATION ──\n\n');
  term.white('  Name: ');
  const name = (await term.inputField({
    cancelable: true,
    default: currentName ?? '',
  }).promise) ?? '';
  term('\n');
  renderLog();
  return name.trim();
}

module.exports = {
  showAdminMenu,
  renderOrganizations,
  renderPlayers,
  showPlayerResetMenu,
  promptOrganizationName,
};
