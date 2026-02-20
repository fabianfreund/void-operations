'use strict';

const { term, clearContent, renderLog } = require('../layout');

function renderOverallStatus(user, drones) {
  clearContent(4);
  term.bold.cyan('  ── OVERALL STATUS ──\n\n');

  term.bold.white(`  Commander: ${user.username}\n`);
  term.white(`  Organization: ${user.org_name ?? 'Unassigned'}\n`);
  term.white(`  Credits: ${user.credits.toFixed(0)} VOIDcredits\n\n`);

  const totals = { idle: 0, travelling: 0, mining: 0, returning: 0, other: 0 };
  for (const d of drones) {
    if (d.status in totals) totals[d.status] += 1;
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
  } else {
    for (const d of drones) {
      term.white(`  ${d.name} [${d.status.toUpperCase()}] @ ${d.location_id}\n`);
    }
  }

  renderLog();
}

module.exports = { renderOverallStatus };
