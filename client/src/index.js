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
const { getServerUrl } = require('./config');

const SERVER_URL = getServerUrl();

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
    dash.addLog(`Drone "${data.droneName}" arrived at ${data.location}`, 'green', {
      droneId: data.droneId,
    });
    dash.stopProgressTracking();
  });

  socket.on('drone:mined', (data) => {
    dash.addLog(
      `Drone "${data.droneName}" mined ${data.yieldKg.toFixed(1)} kg of ${data.resource}`,
      'cyan',
      { droneId: data.droneId }
    );
    dash.stopProgressTracking();
  });

  socket.on('drone:offline', (data) => {
    dash.addLog(
      `Drone "${data.droneName}" went offline near ${data.location} en route to ${data.destination}`,
      'red',
      { droneId: data.droneId }
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
  dash.addLog('Welcome back, commander.');

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

      let drone = await dash.showDroneSelector(drones);
      if (!drone) continue;

      while (true) {
        const action = await dash.showDroneActionMenu(drone);
        if (action === '← Back') break;

        if (action === 'Status') {
          const detail = await socket.getDrone(drone.id);
          dash.renderDroneDetail(detail);
          await term.singleColumnMenu(['← Back'], { leftPadding: '  ' }).promise;
        }

        if (action === 'Commands') {
          while (true) {
            const cmd = await dash.showDroneCommandMenu(drone);
            if (cmd === '← Back') break;

            if (cmd === 'Travel') {
              dash.renderHeader(user);
              const location = await dash.showLocationSelector(world, drone.location_id);
              if (!location) continue;

              try {
                const result = await socket.travel(drone.id, location.id);
                const updated = result.drone;
            dash.addLog(
              `${updated.name} dispatched to ${location.name} — ETA ${Math.max(0, updated.task_eta_at - Math.floor(Date.now() / 1000))}s`,
              'yellow',
              { droneId: drone.id }
            );
            dash.startProgressTracking(updated);
            dash.renderCommandResult('Travel', [
              `Dispatched to ${location.name}.`,
              `Status: ${updated.status.toUpperCase()} · ETA ${Math.max(0, updated.task_eta_at - Math.floor(Date.now() / 1000))}s`,
              `Fuel: ${updated.fuel_current_l.toFixed(1)}L`,
            ], drone.id);
            await term.singleColumnMenu(['← Back'], { leftPadding: '  ' }).promise;
            drone = updated;
          } catch (err) {
            dash.addLog(`Travel failed: ${err.message}`, 'red', { droneId: drone.id });
            dash.renderCommandResult('Travel Failed', [err.message], drone.id);
            await term.singleColumnMenu(['← Back'], { leftPadding: '  ' }).promise;
          }
        }

        if (cmd === 'Mine') {
          try {
            const result = await socket.mine(drone.id);
            const updated = result.drone;
            dash.addLog(`${updated.name} started mining at ${updated.location_id}`, 'cyan', {
              droneId: drone.id,
            });
            dash.startProgressTracking(updated);
            dash.renderCommandResult('Mining', [
              `Mining started at ${updated.location_id}.`,
              `Status: ${updated.status.toUpperCase()}`,
            ], drone.id);
            await term.singleColumnMenu(['← Back'], { leftPadding: '  ' }).promise;
            drone = updated;
          } catch (err) {
            dash.addLog(`Mine failed: ${err.message}`, 'red', { droneId: drone.id });
            dash.renderCommandResult('Mining Failed', [err.message], drone.id);
            await term.singleColumnMenu(['← Back'], { leftPadding: '  ' }).promise;
          }
        }

        if (cmd === 'Sell Cargo') {
          try {
            const result = await socket.sell(drone.id);
            user.credits += result.credits;
            dash.addLog(`Sold cargo for ${result.credits.toFixed(0)} VOIDcredits`, 'green', {
              droneId: drone.id,
            });
            for (const item of result.sold) {
              dash.addLog(`  ${item.resource}: ${item.quantity_kg.toFixed(1)}kg @ ${item.unit_price} = ${item.net_credits}cr`, 'white', {
                droneId: drone.id,
              });
            }
            dash.renderCommandResult('Sell Cargo', [
              `Sold cargo for ${result.credits.toFixed(0)} VOIDcredits.`,
              `Items: ${result.sold.length}`,
            ], drone.id);
            await term.singleColumnMenu(['← Back'], { leftPadding: '  ' }).promise;
            drone = await socket.getDrone(drone.id);
          } catch (err) {
            dash.addLog(`Sell failed: ${err.message}`, 'red', { droneId: drone.id });
            dash.renderCommandResult('Sell Failed', [err.message], drone.id);
            await term.singleColumnMenu(['← Back'], { leftPadding: '  ' }).promise;
          }
        }

        if (cmd === 'Refuel') {
          try {
            const result = await socket.refuel(drone.id);
            user.credits -= result.cost;
            dash.addLog(
              `Refueled ${result.litres_added.toFixed(1)}L for ${result.cost.toFixed(0)} credits`,
              'blue',
              { droneId: drone.id }
            );
            dash.renderCommandResult('Refuel', [
              `Added ${result.litres_added.toFixed(1)}L of fuel.`,
              `Cost: ${result.cost.toFixed(0)} credits.`,
            ], drone.id);
            await term.singleColumnMenu(['← Back'], { leftPadding: '  ' }).promise;
            drone = await socket.getDrone(drone.id);
          } catch (err) {
            dash.addLog(`Refuel failed: ${err.message}`, 'red', { droneId: drone.id });
            dash.renderCommandResult('Refuel Failed', [err.message], drone.id);
            await term.singleColumnMenu(['← Back'], { leftPadding: '  ' }).promise;
          }
        }
          }
        }

        if (action === 'Scan') {
          try {
            const result = await socket.scanNearby(drone.id);
            dash.renderScanResults(result, drone.id);
          } catch (err) {
            dash.addLog(`Scan failed: ${err.message}`, 'red', { droneId: drone.id });
          }
          await term.singleColumnMenu(['← Back'], { leftPadding: '  ' }).promise;
        }
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
          dash.renderHeader(user);
          dash.renderOrganizations(orgs);
          await dash.waitForBack();
        }

        if (action === 'List Players') {
          const players = await socket.listPlayers();
          dash.renderHeader(user);
          dash.renderPlayers(players);
          await dash.waitForBack();
        }

        if (action === 'Settings') {
          while (true) {
            const selected = await dash.showSettingsMenu();
            if (selected === 1) break;
            if (selected === 0) {
              dash.toggleLogSidebar();
              dash.renderHeader(user);
            }
          }
        }
      }
    }

    if (choice === 'Status') {
      const drones = await socket.listFleet();
      dash.renderHeader(user);
      dash.renderOverallStatus(user, drones);
      await dash.waitForBack();
    }
  }
}

main().catch((err) => {
  term.fullscreen(false);
  console.error('\nFatal error:', err.message);
  process.exit(1);
});
