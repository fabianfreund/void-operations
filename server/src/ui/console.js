'use strict';

/**
 * Server Console UI
 *
 * Provides:
 *   - Coloured, levelled log output that doesn't clobber the readline prompt
 *   - An interactive command REPL at the bottom of the terminal
 *   - Commands: help, status, players, drones, tick, broadcast, quit
 */

const readline = require('readline');
const db = require('../../db/init');

// ─── ANSI palette ─────────────────────────────────────────────────────────────

const A = {
  reset:   '\x1b[0m',
  bold:    '\x1b[1m',
  dim:     '\x1b[2m',
  cyan:    '\x1b[36m',
  green:   '\x1b[32m',
  yellow:  '\x1b[33m',
  red:     '\x1b[31m',
  magenta: '\x1b[35m',
  blue:    '\x1b[34m',
  gray:    '\x1b[90m',
  white:   '\x1b[97m',
  bgBlue:  '\x1b[44m',
  bgCyan:  '\x1b[46m',
};

const c = (codes, str) => `${codes}${str}${A.reset}`;

// ─── Readline instance ────────────────────────────────────────────────────────

const PROMPT = `${A.bold}${A.cyan}void>${A.reset} `;

let rl = null;
let rlClosed = false;
let _io = null; // socket.io reference, set by start()

// ─── Log helpers ──────────────────────────────────────────────────────────────

const LEVELS = {
  info:    { label: 'INFO ', color: A.cyan },
  ok:      { label: ' OK  ', color: A.green },
  warn:    { label: 'WARN ', color: A.yellow },
  error:   { label: ' ERR ', color: A.red },
  physics: { label: 'PHYS ', color: A.magenta },
  socket:  { label: 'SOCK ', color: A.blue },
  db:      { label: ' DB  ', color: A.gray },
};

function ts() {
  return new Date().toLocaleTimeString('en-GB', { hour12: false });
}

/**
 * Print a log line without clobbering the readline prompt.
 * Usage: log('info', 'Server started') or log('error', 'DB fail')
 */
function log(level, message) {
  const meta = LEVELS[level] ?? LEVELS.info;
  const line =
    c(A.dim, ts()) +
    '  ' +
    c(A.bold + meta.color, `[${meta.label}]`) +
    '  ' +
    message;

  if (rl && !rlClosed) {
    // Erase the current prompt line, print the log, reprint prompt
    process.stdout.write(`\r\x1b[K${line}\n`);
    rl.prompt(true);
  } else {
    process.stdout.write(line + '\n');
  }
}

// ─── Banner ───────────────────────────────────────────────────────────────────

function printBanner(port) {
  const w = 60;
  const line  = c(A.bold + A.cyan, '═'.repeat(w));
  const pad   = (s) => {
    const inner = `  ${s}`;
    const gap = w - 2 - stripAnsi(inner).length;
    return c(A.bold + A.cyan, '║') + inner + ' '.repeat(Math.max(0, gap)) + c(A.bold + A.cyan, '║');
  };

  console.log('');
  console.log(c(A.bold + A.cyan, '╔' + '═'.repeat(w) + '╗'));
  console.log(pad(c(A.bold + A.white, '  VOID OPERATIONS  ') + c(A.dim, `Server v0.1.0`)));
  console.log(pad(''));
  console.log(pad(c(A.dim, `  Listening on port `) + c(A.bold + A.green, `:${port}`)));
  console.log(pad(c(A.dim, `  SQLite: `) + c(A.gray, 'better-sqlite3')));
  console.log(pad(c(A.dim, `  Physics tick: `) + c(A.yellow, '10 s')));
  console.log(c(A.bold + A.cyan, '╚' + '═'.repeat(w) + '╝'));
  console.log('');
  console.log(c(A.dim, "  Type 'help' for available commands.\n"));
}

// ─── Commands ─────────────────────────────────────────────────────────────────

function handleCommand(input) {
  const [cmd, ...args] = input.trim().split(/\s+/);

  switch (cmd.toLowerCase()) {

    case 'help': {
      const cmds = [
        ['status',          'Show server uptime, connections, and active drones'],
        ['players',         'List all registered accounts and last-seen time'],
        ['drones',          'List all non-idle drones across all players'],
        ['tick',            'Force an immediate physics tick'],
        ['tickrate [ms]',   'Show or set physics tick interval in milliseconds'],
        ['broadcast <msg>', 'Send a system message to all connected clients'],
        ['quit / exit',     'Gracefully shut down the server'],
      ];
      console.log('');
      console.log(c(A.bold + A.cyan, '  ── Commands ─────────────────────────────────'));
      for (const [name, desc] of cmds) {
        console.log(`  ${c(A.bold + A.green, name.padEnd(20))} ${c(A.dim, desc)}`);
      }
      console.log('');
      break;
    }

    case 'status': {
      const uptimeSec = Math.floor(process.uptime());
      const hh = String(Math.floor(uptimeSec / 3600)).padStart(2, '0');
      const mm = String(Math.floor((uptimeSec % 3600) / 60)).padStart(2, '0');
      const ss = String(uptimeSec % 60).padStart(2, '0');

      const connected = _io ? _io.engine.clientsCount : 0;
      const activeDrones = db.prepare(
        "SELECT COUNT(*) as n FROM drones WHERE status IN ('travelling', 'mining', 'emergency')"
      ).get().n;
      const totalUsers = db.prepare('SELECT COUNT(*) as n FROM users').get().n;
      const totalDrones = db.prepare('SELECT COUNT(*) as n FROM drones').get().n;

      console.log('');
      console.log(c(A.bold + A.cyan, '  ── Server Status ──────────────────────────────'));
      console.log(`  Uptime          ${c(A.bold + A.white, `${hh}:${mm}:${ss}`)}`);
      console.log(`  Connected       ${c(A.bold + A.green, String(connected))} clients`);
      console.log(`  Users           ${c(A.bold + A.white, String(totalUsers))} registered`);
      console.log(`  Drones          ${c(A.bold + A.white, String(activeDrones))} active / ${totalDrones} total`);
      console.log(`  Memory          ${c(A.dim, (process.memoryUsage().rss / 1024 / 1024).toFixed(1) + ' MB RSS')}`);
      console.log('');
      break;
    }

    case 'players': {
      const users = db.prepare(
        'SELECT username, credits, last_seen FROM users ORDER BY last_seen DESC'
      ).all();

      if (!users.length) {
        console.log(c(A.dim, '  No players registered yet.\n'));
        break;
      }

      console.log('');
      console.log(c(A.bold + A.cyan, '  ── Players ─────────────────────────────────────'));
      console.log(
        c(A.dim, `  ${'USERNAME'.padEnd(20)} ${'CREDITS'.padEnd(12)} LAST SEEN`)
      );
      for (const u of users) {
        const seen = u.last_seen
          ? new Date(u.last_seen * 1000).toLocaleString()
          : 'never';
        console.log(
          `  ${c(A.bold + A.white, u.username.padEnd(20))}` +
          ` ${c(A.yellow, String(Math.round(u.credits)).padEnd(12))}` +
          ` ${c(A.dim, seen)}`
        );
      }
      console.log('');
      break;
    }

    case 'drones': {
      const drones = db.prepare(
        "SELECT d.name, d.type_id, d.status, d.location_id, d.destination_id, d.task_eta_at, u.username " +
        "FROM drones d JOIN users u ON d.owner_id = u.id WHERE d.status IN ('travelling', 'mining', 'emergency') ORDER BY d.status"
      ).all();

      if (!drones.length) {
        console.log(c(A.dim, '  All drones are idle.\n'));
        break;
      }

      const statusColor = { travelling: A.yellow, emergency: A.yellow, mining: A.cyan, returning: A.blue };
      const nowSec = Math.floor(Date.now() / 1000);

      console.log('');
      console.log(c(A.bold + A.cyan, '  ── Active Drones ───────────────────────────────'));
      for (const d of drones) {
        const sc = statusColor[d.status] ?? A.white;
        const etaStr = d.task_eta_at
          ? `ETA ${Math.max(0, d.task_eta_at - nowSec)}s`
          : '';
        const dest = d.destination_id ? ` → ${d.destination_id}` : '';
        console.log(
          `  ${c(A.bold + A.white, d.name.padEnd(20))}` +
          ` ${c(A.bold + sc, d.status.padEnd(12))}` +
          ` ${c(A.dim, d.location_id + dest)}` +
          ` ${c(A.gray, etaStr)}` +
          `  ${c(A.dim, `[${d.username}]`)}`
        );
      }
      console.log('');
      break;
    }

    case 'tick': {
      const Physics = require('../systems/physics');
      log('physics', 'Manual tick triggered');
      Physics.tick(_io);
      log('ok', 'Tick complete');
      break;
    }

    case 'tickrate': {
      const Physics = require('../systems/physics');
      if (!args.length) {
        log('physics', `Current tick interval: ${Physics.getTickIntervalMs()}ms`);
        break;
      }

      const value = Number(args[0]);
      if (!Number.isFinite(value) || value < 100 || value > 600000) {
        console.log(c(A.dim, '  Usage: tickrate <ms>   (range: 100..600000)\n'));
        break;
      }

      const updatedMs = Physics.setTickIntervalMs(_io, Math.floor(value));
      log('physics', `Tick interval updated to ${updatedMs}ms (${(updatedMs / 1000).toFixed(2)}s)`);
      break;
    }

    case 'broadcast': {
      const message = args.join(' ');
      if (!message) {
        console.log(c(A.dim, '  Usage: broadcast <message>\n'));
        break;
      }
      if (_io) {
        _io.emit('server:broadcast', { message, ts: Date.now() });
        log('ok', `Broadcast sent: "${message}"`);
      } else {
        log('warn', 'Socket.IO not ready yet');
      }
      break;
    }

    case 'quit':
    case 'exit': {
      log('info', 'Shutting down…');
      process.emit('SIGTERM');
      break;
    }

    case '': {
      break; // empty enter — do nothing
    }

    default: {
      console.log(c(A.dim, `  Unknown command: "${cmd}". Type 'help' for a list.\n`));
    }
  }
}

// ─── Start ────────────────────────────────────────────────────────────────────

function start(io, port) {
  _io = io;

  printBanner(port);

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    log('warn', 'TTY not detected — console commands disabled.');
    return;
  }

  rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: PROMPT,
    terminal: true,
  });

  rl.prompt();

  rl.on('line', (line) => {
    handleCommand(line);
    rl.prompt();
  });

  rl.on('close', () => {
    rlClosed = true;
    process.emit('SIGTERM');
  });
}

// ─── Utility ──────────────────────────────────────────────────────────────────

// Strip ANSI codes for length calculation
function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

module.exports = { log, start };
