'use strict';

const term = require('terminal-kit').terminal;
const socket = require('../net/socket');

let didBoot = false;

async function runBootSequence() {
  if (didBoot) return;
  didBoot = true;

  term.clear();
  term.moveTo(1, 1);
  term.bold.cyan('VOID OPERATIONS // ACCESS TERMINAL\n');
  term.gray('Build 0.1.0  |  Secure Channel: ENABLED\n\n');

  await runBar('Initializing core', 650);
  await runBar('Loading navigation maps', 700);
  await runBar('Syncing fleet telemetry', 750);
  await runBar('Verifying credentials module', 650);
  await runBar('Opening command interface', 600);

  term.green('\nStatus: READY\n');
  await sleep(500);
}

async function promptCredentials() {
  term.clear();
  term.moveTo(1, 1);
  term.bold.cyan('========================================\n');
  term.bold.cyan('        VOID OPERATIONS TERMINAL        \n');
  term.bold.cyan('========================================\n');
  term.gray('Authenticated access required.\n');
  term.gray('Use ↑/↓ and Enter to select an action.\n\n');

  const choice = await term.singleColumnMenu(['Login', 'Register', 'Quit'], {
    style: term.white,
    selectedStyle: term.bgCyan.black.bold,
    leftPadding: '  ',
  }).promise;

  if (choice.selectedText === 'Quit') {
    term('\nGoodbye.\n');
    process.exit(0);
  }

  term('\n');
  term.bold.white('User ID: ');
  const username = (await term.inputField({ cancelable: false }).promise).trim();

  term('\n');
  term.bold.white('Access Key: ');
  const password = (await term.inputField({ echo: false, cancelable: false }).promise).trim();
  term('\n\n');

  return { action: choice.selectedText.toLowerCase(), username, password };
}

async function runAuthFlow() {
  await runBootSequence();

  while (true) {
    const { action, username, password } = await promptCredentials();

    try {
      term.bold.white('Connecting…\n');
      let user;

      if (action === 'register') {
        user = await socket.register(username, password);
      } else {
        user = await socket.login(username, password);
      }

      term.bold.green(`\nAuthenticated as ${user.username}.\n`);
      await runPostAuthSequence();
      return user;
    } catch (err) {
      term.bold.red(`\nError: ${err.message}\n`);
      await sleep(1500);
    }
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function renderBar(label, pct, width = 26) {
  const filled = Math.round((pct / 100) * width);
  const bar = `${'█'.repeat(filled)}${'░'.repeat(Math.max(0, width - filled))}`;
  term(`\r${label.padEnd(30, ' ')} [${bar}] ${String(pct).padStart(3, ' ')}%`);
}

async function runBar(label, durationMs) {
  const steps = 20;
  for (let i = 0; i <= steps; i += 1) {
    const pct = Math.round((i / steps) * 100);
    renderBar(label, pct);
    await sleep(Math.floor(durationMs / steps));
  }
  term('\n');
}

async function runPostAuthSequence() {
  term('\n');
  await runBar('Verifying session token', 650);
  await runBar('Decrypting command channel', 700);
  await runBar('Loading command interface', 650);
  term.green('\nAccess granted. Booting main console...\n');
  await sleep(500);
}

module.exports = { runAuthFlow };
