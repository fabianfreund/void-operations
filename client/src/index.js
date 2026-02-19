'use strict';

/**
 * Void Operations — Client Application Loop
 *
 * Wires together: socket connection → auth flow → main dashboard loop
 */

const term = require('terminal-kit').terminal;
const socket = require('./net/socket');
const { runAuthFlow } = require('./ui/auth');
const dash = require('./ui/dashboard');
const world = require('./world'); // local copy of world config

const SERVER_URL = process.env.VOID_SERVER ?? 'http://localhost:3000';

async function main() {
  term.fullscreen(true);
  term.grabInput();

  // ── Connect ─────────────────────────────────────────────────────────────

  term.bold.cyan('Connecting to Void Operations server…\n');
  socket.connect(SERVER_URL);

  await new Promise((resolve, reject) => {
    socket.once('connected', resolve);
    socket.once('connect_error', (msg) => reject(new Error(msg)));
    setTimeout(() => reject(new Error('Connection timed out')), 8000);
  });

  // ── Server-push events ───────────────────────────────────────────────────

  socket.on('drone:arrived', (data) => {
    dash.addLog(`Drone "${data.droneName}" arrived at ${data.location}`, 'green');
    dash.stopProgressTracking();
  });

  socket.on('drone:mined', (data) => {
    dash.addLog(
      `Drone "${data.droneName}" mined ${data.yieldKg.toFixed(1)} kg of ${data.resource}`,
      'cyan'
    );
    dash.stopProgressTracking();
  });

  socket.on('server:error', (data) => {
    dash.addLog(`Server: ${data.message}`, 'red');
  });

  socket.on('disconnected', (reason) => {
    dash.addLog(`Disconnected: ${reason}`, 'red');
  });

  // ── Auth ─────────────────────────────────────────────────────────────────

  const user = await runAuthFlow();

  // ── Main Loop ─────────────────────────────────────────────────────────────

  while (true) {
    const choice = await dash.showMainMenu(user);

    if (choice === 'Quit') {
      term.fullscreen(false);
      term.bold.white('\nGoodbye, commander.\n');
      process.exit(0);
    }

    if (choice === 'View Fleet') {
      const drones = await socket.listFleet();
      dash.renderHeader(user);
      dash.renderFleetTable(drones);

      const drone = await dash.showDroneSelector(drones);
      if (!drone) continue;

      while (true) {
        const action = await dash.showDroneActionMenu(drone);
        if (action === '← Back') break;

        if (action === 'Status') {
          const detail = await socket.getDrone(drone.id);
          dash.renderDroneDetail(detail);
          await term.singleColumnMenu(['← Back'], { leftPadding: '  ' }).promise;
        }

        if (action === 'Scan Nearby Ships') {
          try {
            const result = await socket.scanNearby(drone.id);
            dash.renderScanResults(result);
          } catch (err) {
            dash.addLog(`Scan failed: ${err.message}`, 'red');
          }
          await term.singleColumnMenu(['← Back'], { leftPadding: '  ' }).promise;
        }
      }
    }

    if (choice === 'Travel') {
      const drones = await socket.listFleet();
      const idleDrones = drones.filter((d) => d.status === 'idle');
      if (!idleDrones.length) {
        dash.addLog('No idle drones available to travel.', 'yellow');
        continue;
      }

      dash.renderHeader(user);
      const drone = await dash.showDroneSelector(idleDrones);
      if (!drone) continue;

      dash.renderHeader(user);
      const location = await dash.showLocationSelector(world, drone.location_id);
      if (!location) continue;

      try {
        const result = await socket.travel(drone.id, location.id);
        const updated = result.drone;
        dash.addLog(
          `${updated.name} dispatched to ${location.name} — ETA ${Math.max(0, updated.task_eta_at - Math.floor(Date.now() / 1000))}s`,
          'yellow'
        );
        dash.startProgressTracking(updated);
      } catch (err) {
        dash.addLog(`Travel failed: ${err.message}`, 'red');
      }
    }

    if (choice === 'Mine') {
      const drones = await socket.listFleet();
      const idleDrones = drones.filter((d) => d.status === 'idle');
      if (!idleDrones.length) {
        dash.addLog('No idle drones available.', 'yellow');
        continue;
      }

      dash.renderHeader(user);
      const drone = await dash.showDroneSelector(idleDrones);
      if (!drone) continue;

      try {
        const result = await socket.mine(drone.id);
        const updated = result.drone;
        dash.addLog(`${updated.name} started mining at ${updated.location_id}`, 'cyan');
        dash.startProgressTracking(updated);
      } catch (err) {
        dash.addLog(`Mine failed: ${err.message}`, 'red');
      }
    }

    if (choice === 'Sell Cargo') {
      const drones = await socket.listFleet();
      dash.renderHeader(user);
      const drone = await dash.showDroneSelector(drones);
      if (!drone) continue;

      try {
        const result = await socket.sell(drone.id);
        user.credits += result.credits;
        dash.addLog(`Sold cargo for ${result.credits.toFixed(0)} VOIDcredits`, 'green');
        for (const item of result.sold) {
          dash.addLog(`  ${item.resource}: ${item.quantity_kg.toFixed(1)}kg @ ${item.unit_price} = ${item.net_credits}cr`, 'white');
        }
      } catch (err) {
        dash.addLog(`Sell failed: ${err.message}`, 'red');
      }
    }

    if (choice === 'Refuel') {
      const drones = await socket.listFleet();
      const idleDrones = drones.filter((d) => d.status === 'idle');
      dash.renderHeader(user);
      const drone = await dash.showDroneSelector(idleDrones);
      if (!drone) continue;

      try {
        const result = await socket.refuel(drone.id);
        user.credits -= result.cost;
        dash.addLog(
          `Refueled ${result.litres_added.toFixed(1)}L for ${result.cost.toFixed(0)} credits`,
          'blue'
        );
      } catch (err) {
        dash.addLog(`Refuel failed: ${err.message}`, 'red');
      }
    }

    if (choice === 'Refresh Status') {
      const drones = await socket.listFleet();
      const active = drones.find((d) => d.status !== 'idle');
      if (active) {
        dash.startProgressTracking(active);
        dash.addLog(`Tracking: ${active.name} [${active.status}]`, 'cyan');
      } else {
        dash.addLog('All drones idle.', 'green');
      }
    }

    if (choice === 'Administration') {
      while (true) {
        const action = await dash.showAdminMenu(user);
        if (action === '← Back') break;

        if (action === 'Set Organization') {
          const name = await dash.promptOrganizationName(user.org_name);
          if (!name) continue;
          try {
            const updated = await socket.setOrganization(name);
            Object.assign(user, updated);
            dash.addLog(`Organization set to ${user.org_name}.`, 'green');
          } catch (err) {
            dash.addLog(`Org update failed: ${err.message}`, 'red');
          }
        }

        if (action === 'List Organizations') {
          const orgs = await socket.listOrganizations();
          dash.renderOrganizations(orgs);
          await term.singleColumnMenu(['← Back'], { leftPadding: '  ' }).promise;
        }

        if (action === 'List Players') {
          const players = await socket.listPlayers();
          dash.renderPlayers(players);
          await term.singleColumnMenu(['← Back'], { leftPadding: '  ' }).promise;
        }
      }
    }
  }
}

main().catch((err) => {
  term.fullscreen(false);
  console.error('\nFatal error:', err.message);
  process.exit(1);
});
