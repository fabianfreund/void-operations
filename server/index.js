'use strict';

const http = require('http');
const { Server } = require('socket.io');
const { registerHandlers } = require('./src/network/socketHandler');
const Physics = require('./src/systems/physics');
const serverConsole = require('./src/ui/console');

// Initialize DB (runs schema migrations on first launch)
require('./db/init');

const PORT = process.env.PORT ?? 3000;

const httpServer = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
  } else {
    res.writeHead(404);
    res.end();
  }
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
