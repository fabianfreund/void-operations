#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = process.cwd();
const STATE_DIR = path.join(ROOT, ".void-ops");
const LOG_DIR = path.join(STATE_DIR, "logs");
const PID_DIR = path.join(STATE_DIR, "pids");

const MENU = [
  { label: "Install dependencies", action: installDeps },
  { label: "Start server", action: () => startService("server", ["run", "dev:server"]) },
  { label: "Start client", action: () => startService("client", ["run", "dev:client"]) },
  { label: "Start server + client", action: () => startService("both", ["run", "dev"]) },
  { label: "Kill running processes", action: killAll },
  { label: "Quit", action: () => process.exit(0) },
];

function ensureDirs() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.mkdirSync(PID_DIR, { recursive: true });
}

function pidFile(name) {
  return path.join(PID_DIR, `${name}.pid`);
}

function logFile(name) {
  return path.join(LOG_DIR, `${name}.log`);
}

function isRunning(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readPid(name) {
  const file = pidFile(name);
  if (!fs.existsSync(file)) return null;
  const pid = Number(fs.readFileSync(file, "utf8").trim());
  return Number.isFinite(pid) ? pid : null;
}

function writePid(name, pid) {
  fs.writeFileSync(pidFile(name), String(pid));
}

function removePid(name) {
  const file = pidFile(name);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

function log(msg) {
  process.stdout.write(`${msg}\n`);
}

async function installDeps() {
  log("\nInstalling dependencies (npm install)...\n");
  await runForeground("npm", ["install"], { cwd: ROOT });
  await pause();
}

function startService(name, npmArgs) {
  ensureDirs();
  const existing = readPid(name);
  if (isRunning(existing)) {
    log(`\n${name} already running (pid ${existing}).`);
    return pause();
  }

  const out = fs.openSync(logFile(name), "a");
  const child = spawn("npm", npmArgs, {
    cwd: ROOT,
    detached: true,
    stdio: ["ignore", out, out],
  });

  writePid(name, child.pid);
  child.unref();

  log(`\nStarted ${name} (pid ${child.pid}). Logs: ${path.relative(ROOT, logFile(name))}`);
  return pause();
}

async function killAll() {
  ensureDirs();
  const names = ["server", "client", "both"];
  let killed = 0;

  for (const name of names) {
    const pid = readPid(name);
    if (!pid) continue;

    if (isRunning(pid)) {
      try {
        process.kill(-pid, "SIGTERM");
      } catch {
        try {
          process.kill(pid, "SIGTERM");
        } catch {
          // ignore
        }
      }
      killed++;
    }
    removePid(name);
  }

  log(`\nStopped ${killed} process${killed === 1 ? "" : "es"}.`);
  await pause();
}

function runForeground(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { ...opts, stdio: "inherit" });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited with code ${code}`));
    });
  }).catch((err) => {
    log(`\nError: ${err.message}`);
  });
}

function pause() {
  return new Promise((resolve) => {
    process.stdout.write("\nPress Enter to return to menu...");
    const onData = (buf) => {
      if (buf.toString() === "\r" || buf.toString() === "\n") {
        process.stdin.off("data", onData);
        resolve();
      }
    };
    process.stdin.on("data", onData);
  });
}

function renderMenu(selected) {
  process.stdout.write("\x1b[2J\x1b[0f");
  process.stdout.write("Void Ops Startup\n\n");
  MENU.forEach((item, idx) => {
    if (idx === selected) {
      process.stdout.write(`> ${item.label}\n`);
    } else {
      process.stdout.write(`  ${item.label}\n`);
    }
  });
  process.stdout.write("\nUse ↑/↓ and Enter\n");
}

async function main() {
  let selected = 0;
  renderMenu(selected);

  process.stdin.setRawMode(true);
  process.stdin.resume();

  process.stdin.on("data", async (buf) => {
    const s = buf.toString("utf8");

    if (s === "\u0003") process.exit(0);
    if (s === "\u001b[A") {
      selected = (selected - 1 + MENU.length) % MENU.length;
      renderMenu(selected);
      return;
    }
    if (s === "\u001b[B") {
      selected = (selected + 1) % MENU.length;
      renderMenu(selected);
      return;
    }
    if (s === "\r" || s === "\n") {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      await MENU[selected].action();
      process.stdin.setRawMode(true);
      process.stdin.resume();
      renderMenu(selected);
    }
  });
}

main();
