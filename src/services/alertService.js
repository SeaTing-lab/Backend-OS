// src/services/alertService.js
const getPrismaClient = require('../config/database');
const logger = require('../config/logger');
const wsService = require('./wsService');

const prisma = getPrismaClient();

// Debounce: don't fire same alert within 60 seconds
const lastFired = {};
const DEBOUNCE_MS = 60_000;

async function checkAndAlert(reading) {
  // Load thresholds (use defaults if not set)
  const thresholds = {
    temperatureMax: parseFloat(process.env.DEFAULT_TEMP_MAX) || 35,
    gasLevelMax:    parseInt(process.env.DEFAULT_GAS_MAX) || 300,
    ultrasonicMin:  parseFloat(process.env.DEFAULT_ULTRASONIC_MIN) || 100,
  };

  // Also load per-user thresholds and alert each user
  const users = await prisma.user.findMany({ include: { thresholds: true } });

  for (const user of users) {
    const t = user.thresholds ?? thresholds;
    await checkForUser(user.id, reading, {
      temperatureMax: t.temperatureMax ?? thresholds.temperatureMax,
      gasLevelMax:    t.gasLevelMax    ?? thresholds.gasLevelMax,
      ultrasonicMin:  t.ultrasonicMin  ?? thresholds.ultrasonicMin,
    });
  }

  // Also create system-level alerts (no user)
  await checkForUser(null, reading, thresholds);
}

async function checkForUser(userId, reading, thresholds) {
  const checks = [
    {
      key: `temp_${userId}`,
      condition: reading.temperature > thresholds.temperatureMax,
      type: 'temperature',
      severity: 'danger',
      title: '🌡️ High Temperature',
      description: `Temperature ${reading.temperature.toFixed(1)}°C exceeds ${thresholds.temperatureMax}°C threshold`,
      value: reading.temperature,
    },
    {
      key: `gas_${userId}`,
      condition: reading.gasLevel > thresholds.gasLevelMax,
      type: 'gas',
      severity: 'danger',
      title: '⚠️ Gas / Smoke Detected',
      description: `Gas level ${reading.gasLevel}ppm exceeds safe limit of ${thresholds.gasLevelMax}ppm`,
      value: reading.gasLevel,
    },
    {
      key: `door_${userId}`,
      condition: reading.doorOpen,
      type: 'door',
      severity: 'warning',
      title: '🚪 Door Opened',
      description: 'Access door sensor triggered — entry detected',
      value: null,
    },
    {
      key: `motion_${userId}`,
      condition: reading.distance < thresholds.ultrasonicMin,
      type: 'motion',
      severity: 'warning',
      title: '📡 Motion Detected',
      description: `Object at ${reading.distance.toFixed(0)}cm — within ${thresholds.ultrasonicMin}cm range`,
      value: reading.distance,
    },
    {
      key: `rain_${userId}`,
      condition: reading.isRaining,
      type: 'rain',
      severity: 'info',
      title: '🌧️ Rain Detected',
      description: 'Rain sensor active — auto-closing windows via servo',
      value: null,
    },
  ];

  for (const check of checks) {
    if (!check.condition) continue;

    // Debounce
    const now = Date.now();
    if (lastFired[check.key] && now - lastFired[check.key] < DEBOUNCE_MS) continue;
    lastFired[check.key] = now;

    // Save to DB
    const alert = await prisma.alert.create({
      data: {
        userId,
        type: check.type,
        severity: check.severity,
        title: check.title,
        description: check.description,
        value: check.value,
      },
    });

    logger.warn(`Alert [${check.severity}]: ${check.title}`);

    // Push via WebSocket
    wsService.broadcast({ type: 'alert', data: alert });

    // TODO: send FCM push notification here
    // await sendFcmPush(userId, check.title, check.description);
  }
}

async function getAlerts({ userId, page = 1, limit = 20, unreadOnly = false }) {
  const where = {};
  if (userId) where.userId = userId;
  if (unreadOnly) where.isRead = false;

  const [alerts, total] = await Promise.all([
    prisma.alert.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.alert.count({ where }),
  ]);

  return { alerts, total, page, totalPages: Math.ceil(total / limit) };
}

async function markRead(alertId, userId) {
  return prisma.alert.update({
    where: { id: alertId },
    data: { isRead: true },
  });
}

async function markAllRead(userId) {
  return prisma.alert.updateMany({
    where: { userId, isRead: false },
    data: { isRead: true },
  });
}

module.exports = { checkAndAlert, getAlerts, markRead, markAllRead };