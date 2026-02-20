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
const { autoUpdateIfNeeded } = require('./updater');
const { version: CLIENT_VERSION } = require('../package.json');

const SERVER_URL = getServerUrl();
let sessionEnded = false;

function endSession(message) {
  if (sessionEnded) return;
  sessionEnded = true;
  try {
    socket.disconnect();
  } catch {
    // ignore
  }
  term.fullscreen(false);
  term.grabInput(false);
  term.bold.red(`\n${message}\n`);
  process.exit(0);
}

async function main() {
  await autoUpdateIfNeeded(CLIENT_VERSION);

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

  socket.on('drone:emergency', (data) => {
    dash.addLog(
      `Drone "${data.droneName}" entered emergency battery mode near ${data.location} (${data.batterySec}s remaining)`,
      'yellow',
      { droneId: data.droneId }
    );
    dash.stopProgressTracking();
  });

  socket.on('server:error', (data) => {
    dash.addLog(`Server: ${data.message}`, 'red');
  });

  socket.on('disconnected', (reason) => {
    const reasonText = reason || 'unknown';
    const isExpectedClientQuit = reasonText === 'io client disconnect';
    if (!isExpectedClientQuit) {
      endSession(`Disconnected from server (${reasonText}). Please reconnect and log in again.`);
    }
  });

  socket.on('server:maintenance', (payload = {}) => {
    const message =
      payload.message ||
      'Server is restarting or deploying an update. You have been logged out.';
    endSession(message);
  });

  // ── Auth ─────────────────────────────────────────────────────────────────

  const user = await runAuthFlow();
  dash.addLog('Welcome back, commander.');

  async function refreshFleetState(selectedDroneId = null) {
    const drones = await socket.listFleet();
    dash.setCachedDrones(drones);
    if (!selectedDroneId) return { drones, drone: null };
    return {
      drones,
      drone: drones.find((d) => d.id === selectedDroneId) ?? null,
    };
  }

  // ── Main Loop ─────────────────────────────────────────────────────────────

  while (true) {
    const choice = await dash.showMainMenu(user);

    if (choice === 'Quit') {
      term.fullscreen(false);
      term.bold.white('\nGoodbye, commander.\n');
      process.exit(0);
    }

    if (choice === 'View Fleet') {
      const { drones } = await refreshFleetState();
      dash.renderHeader(user);
      dash.renderFleetTable(drones);

      let drone = await dash.showDroneSelector(drones);
      if (!drone) continue;

      while (true) {
        const { drone: refreshedDrone } = await refreshFleetState(drone.id);
        if (refreshedDrone) {
          drone = refreshedDrone;
        } else {
          dash.addLog('Selected drone no longer available.', 'red');
          break;
        }

        const action = await dash.showDroneActionMenu(drone);
        if (action === '← Back') break;

        if (action === 'Pin Drone' || action === 'Unpin Drone') {
          const pinned = dash.togglePinnedDrone(drone.id);
          dash.addLog(
            `${pinned ? 'Pinned' : 'Unpinned'} "${drone.name}".`,
            'white',
            { droneId: drone.id }
          );
          continue;
        }

        if (action === 'Status') {
          const detail = await socket.getDrone(drone.id);
          dash.renderDroneDetail(detail);
          await term.singleColumnMenu(['← Back'], { leftPadding: '  ' }).promise;
        }

        if (action === 'Rename Drone') {
          const name = await dash.promptDroneName(drone.name, drone.id);
          if (!name) continue;
          try {
            const result = await socket.renameDrone(drone.id, name);
            drone = result.drone;
            dash.addLog(`Drone renamed to "${drone.name}".`, 'green', { droneId: drone.id });
            dash.renderCommandResult('Rename Drone', [`New name: ${drone.name}`], drone.id);
            await term.singleColumnMenu(['← Back'], { leftPadding: '  ' }).promise;
          } catch (err) {
            dash.addLog(`Rename failed: ${err.message}`, 'red', { droneId: drone.id });
            dash.renderCommandResult('Rename Failed', [err.message], drone.id);
            await term.singleColumnMenu(['← Back'], { leftPadding: '  ' }).promise;
          }
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

        if (cmd === 'Stop In Place') {
          try {
            const result = await socket.stopInPlace(drone.id);
            const updated = result.drone;
            dash.stopProgressTracking();
            dash.addLog(`${updated.name} stopped in place at ${updated.location_id}`, 'yellow', {
              droneId: drone.id,
            });
            dash.renderCommandResult('Stop In Place', [
              `Travel aborted. Drone is now ${updated.status.toUpperCase()}.`,
              `Location: ${updated.location_id}`,
              `Coordinates: (${updated.coord_x?.toFixed?.(1) ?? '?'}, ${updated.coord_y?.toFixed?.(1) ?? '?'})`,
            ], drone.id);
            await term.singleColumnMenu(['← Back'], { leftPadding: '  ' }).promise;
            drone = updated;
          } catch (err) {
            dash.addLog(`Stop failed: ${err.message}`, 'red', { droneId: drone.id });
            dash.renderCommandResult('Stop Failed', [err.message], drone.id);
            await term.singleColumnMenu(['← Back'], { leftPadding: '  ' }).promise;
          }
        }

        if (cmd === 'Scan/Comms') {
          if (drone.status !== 'idle' && drone.status !== 'emergency') {
            dash.addLog(`Scan failed: Drone must be idle or emergency to scan.`, 'red', { droneId: drone.id });
            dash.renderCommandResult('Scan Failed', ['Drone must be idle or emergency to scan.'], drone.id);
            await term.singleColumnMenu(['← Back'], { leftPadding: '  ' }).promise;
          } else {
            try {
              const result = await socket.scanNearby(drone.id);
              await dash.runScanWorkflow(result, drone.id);
            } catch (err) {
              dash.addLog(`Scan failed: ${err.message}`, 'red', { droneId: drone.id });
              await term.singleColumnMenu(['← Back'], { leftPadding: '  ' }).promise;
            }
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

        if (action === 'Reset Player') {
          const players = await socket.listPlayers();
          const selected = await dash.showPlayerResetMenu(players);
          if (!selected) continue;
          try {
            const result = await socket.resetPlayer(selected.id);
            dash.addLog(`Player reset: ${result.player.username}`, 'yellow');
            if (result.player.id === user.id) Object.assign(user, result.player);
          } catch (err) {
            dash.addLog(`Reset failed: ${err.message}`, 'red');
          }
        }

        if (action === 'Settings') {
          while (true) {
            const selected = await dash.showSettingsMenu();
            if (selected === 3) break; // ← Back
            if (selected === 0) {
              dash.toggleLogSidebar();
              dash.renderHeader(user);
            }
            if (selected === 1) {
              const mode = await dash.showInfoPanelMenu();
              if (mode === 0) dash.setInfoPanelMode('off');
              else if (mode === 1) dash.setInfoPanelMode('fleet');
              else if (mode === 2) dash.setInfoPanelMode('pinned');
              dash.renderHeader(user);
            }
            if (selected === 2) {
              await dash.showPinnedFieldsMenu();
            }
          }
        }
      }
    }

    if (choice === 'Status') {
      const drones = await socket.listFleet();
      dash.setCachedDrones(drones);
      dash.renderHeader(user);
      await dash.renderOverallStatus(user, drones);
      await dash.waitForBack();
    }
  }
}

main().catch((err) => {
  term.fullscreen(false);
  console.error('\nFatal error:', err.message);
  process.exit(1);
});
