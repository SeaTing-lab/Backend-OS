// src/services/wsService.js
const { WebSocketServer, WebSocket } = require('ws');
const logger = require('../config/logger');

let wss = null;
const clients = new Set();

// ── Attach to existing HTTP server ────────────────────────────────────────
function attach(server) {
  wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    const ip = req.socket.remoteAddress;
    clients.add(ws);
    logger.info(`WS client connected (${ip}) — total: ${clients.size}`);

    // Send current state on connect
    ws.send(JSON.stringify({ type: 'connected', data: { message: 'Smart Home WS ready' } }));

    ws.on('message', (msg) => {
      try {
        const payload = JSON.parse(msg.toString());
        logger.debug(`WS message from ${ip}: ${JSON.stringify(payload)}`);
        // Clients can send ping to keep alive
        if (payload.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
        }
      } catch (e) {
        logger.warn(`Invalid WS message from ${ip}`);
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
      logger.info(`WS client disconnected — total: ${clients.size}`);
    });

    ws.on('error', (err) => {
      clients.delete(ws);
      logger.error(`WS error: ${err.message}`);
    });
  });

  logger.info('WebSocket server ready on /ws');
}

// ── Broadcast to all connected clients ────────────────────────────────────
function broadcast(payload) {
  if (clients.size === 0) return;
  const msg = JSON.stringify(payload);
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(msg, (err) => {
        if (err) clients.delete(ws);
      });
    } else {
      clients.delete(ws);
    }
  }
}

function clientCount() {
  return clients.size;
}

module.exports = { attach, broadcast, clientCount };