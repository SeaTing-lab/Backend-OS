// src/index.js
require('dotenv').config();
const http = require('http');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const logger = require('./config/logger');
const mqttService = require('./services/mqttService');
const wsService = require('./services/wsService');
const alertService = require('./services/alertService');
const cronService = require('./services/cronService');

const authRoutes    = require('./routes/auth');
const sensorRoutes  = require('./routes/sensors');
const deviceRoutes  = require('./routes/devices');
const alertRoutes   = require('./routes/alerts');
const systemRoutes  = require('./routes/system');

// ── Express app ───────────────────────────────────────────────────────────
const app = express();

app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json());

// Rate limit: 200 req/min per IP
app.use(rateLimit({ windowMs: 60_000, max: 200, standardHeaders: true }));

// ── Routes ────────────────────────────────────────────────────────────────
app.use('/api/auth',    authRoutes);
app.use('/api/sensors', sensorRoutes);
app.use('/api/devices', deviceRoutes);
app.use('/api/alerts',  alertRoutes);
app.use('/api/system',  systemRoutes);

// Health check (no auth)
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime().toFixed(0) + 's',
    mqtt: mqttService.isConnected() ? 'connected' : 'disconnected',
    wsClients: wsService.clientCount(),
    time: new Date().toISOString(),
  });
});

// 404
app.use((req, res) => res.status(404).json({ error: 'Route not found' }));

// Global error handler
app.use((err, req, res, next) => {
  logger.error(`Unhandled error: ${err.message}`);
  res.status(500).json({ error: 'Internal server error' });
});

// ── HTTP + WebSocket server ───────────────────────────────────────────────
const server = http.createServer(app);
wsService.attach(server);

// ── Inject cross-service dependencies ────────────────────────────────────
mqttService.inject(wsService, alertService);

// ── Start ─────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0'; // ✅ FIXED: bind to all interfaces so Docker exposes to LAN

server.listen(PORT, HOST, () => {
  logger.info(`🚀 Server running on http://${HOST}:${PORT}`);
  logger.info(`   REST API  → http://${HOST}:${PORT}/api`);
  logger.info(`   WebSocket → ws://${HOST}:${PORT}/ws`);
  logger.info(`   Health    → http://${HOST}:${PORT}/health`);
});

// Connect MQTT
mqttService.connect();

// Start cron jobs
cronService.start();

module.exports = app;