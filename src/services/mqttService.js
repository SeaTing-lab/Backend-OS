// src/services/mqttService.js
const mqtt = require('mqtt');
const getPrismaClient = require('../config/database');
const logger = require('../config/logger');

const prisma = getPrismaClient();
let wsService = null; // injected after init
let alertService = null;

let client = null;
let lastSeenEsp32 = null;
let connectionAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;

// ── Connect to HiveMQ Cloud ────────────────────────────────────────────────
function connect() {
  // HiveMQ Cloud uses TLS on port 8883 (mqtts://)
  const host     = process.env.HIVEMQ_HOST;      // e.g. abc123.s1.eu.hivemq.cloud
  const port     = process.env.HIVEMQ_PORT || 8883;
  const username = process.env.HIVEMQ_USERNAME;
  const password = process.env.HIVEMQ_PASSWORD;

  if (!host || !username || !password) {
    logger.warn('HiveMQ credentials missing — MQTT disabled. Set HIVEMQ_HOST, HIVEMQ_USERNAME, HIVEMQ_PASSWORD in .env');
    logger.warn('Server will run without MQTT connectivity. ESP32 communication will not work.');
    return;
  }

  const url = `mqtts://${host}:${port}`;

  client = mqtt.connect(url, {
    clientId:        process.env.MQTT_CLIENT_ID || `smart_home_backend_${Date.now()}`,
    username,
    password,
    // HiveMQ Cloud requires TLS — use system CA (no custom cert needed)
    rejectUnauthorized: true,
    reconnectPeriod: 5000,
    keepalive:       60,
    clean:           true,
    will: {
      topic:   'backend/status',
      payload: JSON.stringify({ online: false }),
      retain:  true,
      qos:     1,
    },
  });

  client.on('connect', () => {
    logger.info(`MQTT connected to ${url}`);
    client.publish('backend/status', JSON.stringify({ online: true }), { retain: true });
    subscribeAll();
  });

  client.on('message', handleMessage);

  client.on('error', (err) => {
    logger.error(`MQTT error: ${err.message}`);
    if (connectionAttempts >= MAX_RECONNECT_ATTEMPTS) {
      logger.error('MQTT max reconnection attempts reached. Giving up.');
      client.end(true);
      client = null;
    }
  });

  client.on('reconnect', () => {
    connectionAttempts++;
    logger.warn(`MQTT reconnecting… (attempt ${connectionAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
  });

  client.on('offline', () => {
    logger.warn('MQTT offline');
    updateEsp32Status(false);
  });
}

// ── Subscribe to all ESP32 topics ─────────────────────────────────────────
function subscribeAll() {
  const topics = [
    'esp32/sensors',
    'esp32/temperature',
    'esp32/gas',
    'esp32/rain',
    'esp32/ultrasonic',
    'esp32/door',
    'esp32/status',
    'smart_home/status', // LWT from ESP32
  ];
  topics.forEach((t) => client.subscribe(t, { qos: 1 }));
  logger.info(`Subscribed to ${topics.length} topics`);
}

// ── Handle incoming message ───────────────────────────────────────────────
async function handleMessage(topic, buffer) {
  const raw = buffer.toString();
  let data = {};

  try {
    data = JSON.parse(raw);
  } catch {
    data = { value: raw };
  }

  logger.debug(`MQTT [${topic}]: ${raw.substring(0, 120)}`);

  // ESP32 LWT / status
  if (topic === 'smart_home/status' || topic === 'esp32/status') {
    const online = data === 'online' || data.online === true || raw === 'online';
    updateEsp32Status(online);
    return;
  }

  // Mark ESP32 as online whenever we receive any message
  if (!lastSeenEsp32 || Date.now() - lastSeenEsp32 > 10000) {
    updateEsp32Status(true);
  }
  lastSeenEsp32 = Date.now();

  // Combined sensor payload
  if (topic === 'esp32/sensors') {
    await handleSensorPayload(data, raw);
  }
}

// ── Sanitize and validate sensor payload ───────────────────────────────────
function sanitizeSensorData(data) {
  // Clamp temperature to realistic range: -50 to 100 °C
  const temperature = Math.max(-50, Math.min(100, parseFloat(data.temperature) || 0));

  // Clamp humidity: 0 to 100 %
  const humidity = Math.max(0, Math.min(100, parseFloat(data.humidity) || 0));

  // Clamp gas level: 0 to 10000 ppm
  const gasLevel = Math.max(0, Math.min(10000, parseInt(data.gas_level) || 0));

  // Clamp ultrasonic distance: 0 to 1000 cm
  const distance = Math.max(0, Math.min(1000, parseFloat(data.ultrasonic) || 0));

  return {
    temperature,
    humidity,
    gasLevel,
    isRaining: Boolean(data.rain),
    doorOpen: Boolean(data.door_open),
    distance,
  };
}

// ── Save sensor reading to DB + broadcast + check alerts ──────────────────
async function handleSensorPayload(data, raw) {
  const sanitized = sanitizeSensorData(data);
  const reading = {
    ...sanitized,
    rawPayload:  raw,
  };

  // Persist to database
  const saved = await prisma.sensorReading.create({ data: reading });

  // Broadcast via WebSocket to all connected Flutter clients
  if (wsService) {
    wsService.broadcast({ type: 'sensor_update', data: { ...reading, id: saved.id, createdAt: saved.createdAt } });
  }

  // Check thresholds and fire alerts
  if (alertService) {
    await alertService.checkAndAlert(reading);
  }
}

// ── Publish relay/actuator command ────────────────────────────────────────
function publishCommand(channel, state) {
  if (!client?.connected) {
    logger.warn(`MQTT not connected — cannot publish to ${channel}`);
    return false;
  }
  const payload = JSON.stringify({ state: state ? 'ON' : 'OFF' });
  client.publish(channel, payload, { qos: 1 }, (err) => {
    if (err) logger.error(`Publish error on ${channel}: ${err.message}`);
    else logger.info(`Published ${channel} → ${state ? 'ON' : 'OFF'}`);
  });
  return true;
}

function publishMode(mode) {
  if (!client?.connected) return false;
  client.publish('esp32/mode', JSON.stringify({ mode }), { qos: 1 });
  return true;
}

// ── ESP32 online status ────────────────────────────────────────────────────
async function updateEsp32Status(online) {
  try {
    await prisma.systemState.update({ where: { id: 1 }, data: { esp32Online: online } });
    if (wsService) wsService.broadcast({ type: 'esp32_status', data: { online } });
    logger.info(`ESP32 status: ${online ? 'ONLINE' : 'OFFLINE'}`);
  } catch (e) {
    logger.error(`Failed to update ESP32 status: ${e.message}`);
  }
}

function isConnected() {
  return client?.connected ?? false;
}

function inject(ws, alerts) {
  wsService = ws;
  alertService = alerts;
}

module.exports = { connect, publishCommand, publishMode, isConnected, inject };


