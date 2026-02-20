'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');
const { registerHandlers } = require('./src/network/socketHandler');
const Physics = require('./src/systems/physics');
const serverConsole = require('./src/ui/console');

// Initialize DB (runs schema migrations on first launch)
require('./db/init');

const PORT = process.env.PORT ?? 3000;
const CLIENT_TARBALL = path.join(__dirname, 'client-dist', 'void-term.tgz');
const CLIENT_PACKAGE_JSON = path.join(__dirname, '..', 'client', 'package.json');
const SHUTDOWN_FORCE_EXIT_MS = Number(process.env.SHUTDOWN_FORCE_EXIT_MS ?? 10000);
const RECENT_REQUESTS_LIMIT = Number(process.env.RECENT_REQUESTS_LIMIT ?? 20);

const activeSockets = new Set();
const recentRequests = [];
let shuttingDown = false;
let forceExitTimer = null;

function rememberRequest(entry) {
  recentRequests.push(entry);
  if (recentRequests.length > RECENT_REQUESTS_LIMIT) recentRequests.shift();
}

function formatUptime(totalSec) {
  const sec = Math.max(0, Math.floor(totalSec));
  const hh = String(Math.floor(sec / 3600)).padStart(2, '0');
  const mm = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
  const ss = String(sec % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function getBundledClientVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(CLIENT_PACKAGE_JSON, 'utf8'));
    return pkg?.version || null;
  } catch {
    return null;
  }
}

function countByName(items) {
  const counts = {};
  for (const item of items) {
    const key = item?.constructor?.name || typeof item;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function getRuntimeDiagnostics(signal) {
  const activeHandles =
    typeof process._getActiveHandles === 'function' ? process._getActiveHandles() : [];
  const activeRequests =
    typeof process._getActiveRequests === 'function' ? process._getActiveRequests() : [];
  const mem = process.memoryUsage();
  const ioClients = io?.engine?.clientsCount ?? 0;

  return {
    signal,
    pid: process.pid,
    uptime: formatUptime(process.uptime()),
    httpConnections: activeSockets.size,
    socketIoClients: ioClients,
    rssMB: Number((mem.rss / 1024 / 1024).toFixed(1)),
    heapUsedMB: Number((mem.heapUsed / 1024 / 1024).toFixed(1)),
    activeHandleCounts: countByName(activeHandles),
    activeRequestCounts: countByName(activeRequests),
    recentRequests: [...recentRequests],
  };
}

function getBaseUrl(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/+$/, '');
  const forwardedProto = req.headers['x-forwarded-proto'];
  const forwardedHost = req.headers['x-forwarded-host'];
  const host = (Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost) || req.headers.host;
  const proto =
    (Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto) ||
    (req.socket.encrypted ? 'https' : 'http');
  return `${proto}://${host}`;
}

function logRequest(req, statusCode) {
  const ip =
    (Array.isArray(req.headers['x-forwarded-for'])
      ? req.headers['x-forwarded-for'][0]
      : req.headers['x-forwarded-for']) ||
    req.socket.remoteAddress ||
    '-';
  const ua = req.headers['user-agent'] || '-';
  serverConsole.log(
    'info',
    `${req.method} ${req.url} -> ${statusCode} (${ip}) "${ua}"`
  );
  rememberRequest({
    ts: new Date().toISOString(),
    method: req.method,
    path: req.url,
    statusCode,
    ip,
    ua,
  });
}

const httpServer = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  const routePath = pathname.replace(/\/{2,}/g, '/');

  if (routePath === '/' || routePath === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
    logRequest(req, 200);
    return;
  }

  if (routePath === '/client/void-term.tgz') {
    if (!fs.existsSync(CLIENT_TARBALL)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Client package not available.');
      logRequest(req, 404);
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': 'attachment; filename="void-term.tgz"',
    });
    fs.createReadStream(CLIENT_TARBALL).pipe(res);
    res.on('finish', () => logRequest(req, 200));
    return;
  }

  if (routePath === '/client/version') {
    const version = getBundledClientVersion();
    if (!version) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'client version unavailable' }));
      logRequest(req, 503);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ name: 'void-term', version }));
    logRequest(req, 200);
    return;
  }

  if (routePath === '/client/install') {
    const baseUrl = getBaseUrl(req);
    const script = `#!/usr/bin/env sh
set -e

SERVER_URL="${baseUrl}"
TARBALL_URL="$SERVER_URL/client/void-term.tgz"
CONFIG_DIR="$HOME/.void-ops"
CONFIG_FILE="$CONFIG_DIR/client.json"

mkdir -p "$CONFIG_DIR"
printf '{\"serverUrl\":\"%s\"}\\n' "$SERVER_URL" > "$CONFIG_FILE"

npm install -g "$TARBALL_URL"
echo "Installed void-term. Run: void-term"
`;
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(script);
    logRequest(req, 200);
    return;
  }

  res.writeHead(404);
  res.end();
  logRequest(req, 404);
});

const io = new Server(httpServer, {
  cors: { origin: '*' },
});

httpServer.on('connection', (socket) => {
  activeSockets.add(socket);
  socket.on('close', () => activeSockets.delete(socket));
});

httpServer.on('close', () => {
  serverConsole.log('info', 'HTTP server closed');
});

httpServer.on('error', (err) => {
  serverConsole.log('error', `HTTP server error: ${err?.stack ?? err}`);
});

io.on('connection', (socket) => {
  serverConsole.log('socket', `New connection: ${socket.id}`);
  registerHandlers(io, socket);
});

// Start the physics simulation loop
Physics.start(io);

httpServer.listen(PORT, () => {
  // Start the server console UI after the port is bound
  serverConsole.start(io, PORT);
  serverConsole.log(
    'info',
    `Runtime: node ${process.version} on ${process.platform}/${process.arch} | PORT=${PORT} | NODE_ENV=${process.env.NODE_ENV ?? 'undefined'}`
  );
  serverConsole.log('info', `PID ${process.pid} listening on port ${PORT}`);
});

function shutdown(signal) {
  if (shuttingDown) {
    serverConsole.log('warn', `Shutdown already in progress — ignoring duplicate signal ${signal}`);
    return;
  }
  shuttingDown = true;

  serverConsole.log('warn', `Shutting down — signal ${signal}`);
  serverConsole.log('warn', `Shutdown diagnostics: ${JSON.stringify(getRuntimeDiagnostics(signal))}`);

  forceExitTimer = setTimeout(() => {
    serverConsole.log('error', `Forced exit after ${SHUTDOWN_FORCE_EXIT_MS}ms waiting for graceful shutdown`);
    process.exit(1);
  }, SHUTDOWN_FORCE_EXIT_MS);
  forceExitTimer.unref();

  try {
    Physics.stop();
  } catch (err) {
    serverConsole.log('error', `Physics stop error: ${err?.message ?? err}`);
  }
  try {
    io.close();
  } catch (err) {
    serverConsole.log('error', `Socket.IO close error: ${err?.message ?? err}`);
  }
  httpServer.close((err) => {
    if (err) serverConsole.log('error', `HTTP close error: ${err?.message ?? err}`);
    if (forceExitTimer) clearTimeout(forceExitTimer);
    process.exit(0);
  });
}

// Graceful shutdown + crash visibility
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('uncaughtException', (err) => {
  serverConsole.log('error', `Uncaught exception: ${err?.stack ?? err}`);
  shutdown('uncaughtException');
});
process.on('unhandledRejection', (reason) => {
  serverConsole.log('error', `Unhandled rejection: ${reason?.stack ?? reason}`);
});
process.on('exit', (code) => {
  serverConsole.log('warn', `Process exit with code ${code}`);
});
