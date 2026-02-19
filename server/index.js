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

const httpServer = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');

  if (pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
    return;
  }

  if (pathname === '/client/void-term.tgz') {
    if (!fs.existsSync(CLIENT_TARBALL)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Client package not available.');
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': 'attachment; filename="void-term.tgz"',
    });
    fs.createReadStream(CLIENT_TARBALL).pipe(res);
    return;
  }

  if (pathname === '/client/install') {
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
    return;
  }

  res.writeHead(404);
  res.end();
});

const io = new Server(httpServer, {
  cors: { origin: '*' },
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
});

// Graceful shutdown
process.on('SIGTERM', () => {
  serverConsole.log('warn', 'Shutting down — goodbye');
  Physics.stop();
  io.close();
  httpServer.close(() => process.exit(0));
});
