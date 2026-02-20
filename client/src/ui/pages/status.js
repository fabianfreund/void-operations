'use strict';

const { term, clearContent, renderLog } = require('../layout');

const STATUS_ROW_DELAY_MS = 55;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function renderOverallStatus(user, drones) {
  clearContent(4);
  term.bold.cyan('  ── OVERALL STATUS ──\n\n');

  term.bold.white(`  Commander: ${user.username}\n`);
  await wait(STATUS_ROW_DELAY_MS);
  term.white(`  Organization: ${user.org_name ?? 'Unassigned'}\n`);
  await wait(STATUS_ROW_DELAY_MS);
  term.white(`  Credits: ${user.credits.toFixed(0)} VOIDcredits\n\n`);
  await wait(STATUS_ROW_DELAY_MS);

  const totals = { idle: 0, travelling: 0, emergency: 0, mining: 0, returning: 0, offline: 0, other: 0 };
  for (const d of drones) {
    if (d.status in totals) totals[d.status] += 1;
    else totals.other += 1;
  }

  term.bold.white('  Fleet Summary:\n');
  await wait(STATUS_ROW_DELAY_MS);
  term.white(`  Total drones: ${drones.length}\n`);
  await wait(STATUS_ROW_DELAY_MS);
  term.green(`  Idle: ${totals.idle}\n`);
  await wait(STATUS_ROW_DELAY_MS);
  term.yellow(`  Travelling: ${totals.travelling}\n`);
  await wait(STATUS_ROW_DELAY_MS);
  term.yellow(`  Emergency: ${totals.emergency}\n`);
  await wait(STATUS_ROW_DELAY_MS);
  term.cyan(`  Mining: ${totals.mining}\n`);
  await wait(STATUS_ROW_DELAY_MS);
  term.blue(`  Returning: ${totals.returning}\n`);
  await wait(STATUS_ROW_DELAY_MS);
  term.red(`  Offline: ${totals.offline}\n`);
  await wait(STATUS_ROW_DELAY_MS);
  if (totals.other) term.white(`  Other: ${totals.other}\n`);
  if (totals.other) await wait(STATUS_ROW_DELAY_MS);

  const active = drones.find((d) => d.status !== 'idle');
  if (active) {
    term('\n');
    term.bold.white('  Active Task:\n');
    await wait(STATUS_ROW_DELAY_MS);
    term.white(`  ${active.name} [${active.status.toUpperCase()}] @ ${active.location_id}\n`);
    await wait(STATUS_ROW_DELAY_MS);
  }

  term('\n');
  term.bold.white('  Drone Positions:\n');
  if (!drones.length) {
    term.white('  No drones registered.\n');
  } else {
    for (const d of drones) {
      term.white(`  ${d.name} [${d.status.toUpperCase()}] @ ${d.location_id}\n`);
      await wait(STATUS_ROW_DELAY_MS);
    }
  }

  renderLog();
}

module.exports = { renderOverallStatus };
