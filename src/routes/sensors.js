// src/routes/sensors.js
const express = require('express');
const getPrismaClient = require('../config/database');
const auth = require('../middleware/auth');

const router = express.Router();
const prisma = getPrismaClient();

// POST /api/sensors/readings  - app background upload queue fallback
router.post('/readings', async (req, res, next) => {
  try {
    const rawReadings = Array.isArray(req.body)
      ? req.body
      : Array.isArray(req.body?.readings)
        ? req.body.readings
        : [req.body];

    const saved = [];
    for (const raw of rawReadings.slice(0, 500)) {
      const reading = normalizeQueuedSensor(raw || {});
      const existing = await prisma.sensorReading.findFirst({
        where: {
          createdAt: reading.createdAt,
          temperature: reading.temperature,
          humidity: reading.humidity,
          gasLevel: reading.gasLevel,
          isRaining: reading.isRaining,
          distance: reading.distance,
          doorOpen: reading.doorOpen,
        },
      });
      const stored = existing || await prisma.sensorReading.create({ data: reading });
      saved.push(stored);
    }

    return res.status(201).json({ saved: saved.length, readings: saved });
  } catch (error) {
    return next(error);
  }
});

// GET /api/sensors/latest  â€” most recent reading
router.get('/latest', auth, async (req, res) => {
  const reading = await prisma.sensorReading.findFirst({
    orderBy: { createdAt: 'desc' },
  });
  if (!reading) return res.status(404).json({ error: 'No readings yet' });
  return res.json(reading);
});

// GET /api/sensors/history?limit=60&from=ISO&to=ISO
router.get('/history', auth, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 60, 500);
  const where = {};

  if (req.query.from || req.query.to) {
    where.createdAt = {};
    if (req.query.from) where.createdAt.gte = new Date(req.query.from);
    if (req.query.to)   where.createdAt.lte = new Date(req.query.to);
  }

  const readings = await prisma.sensorReading.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      temperature: true,
      gasLevel: true,
      isRaining: true,
      distance: true,
      doorOpen: true,
      createdAt: true,
    },
  });

  return res.json({ readings: readings.reverse(), count: readings.length });
});

// GET /api/sensors/stats?hours=24  â€” min/max/avg per sensor
router.get('/stats', auth, async (req, res) => {
  const hours = parseInt(req.query.hours) || 24;
  const since = new Date(Date.now() - hours * 3600 * 1000);

  const readings = await prisma.sensorReading.findMany({
    where: { createdAt: { gte: since } },
    select: { temperature: true, gasLevel: true, distance: true },
  });

  if (readings.length === 0) return res.json({ message: 'No data in range' });

  const temps = readings.map((r) => r.temperature);
  const gas   = readings.map((r) => r.gasLevel);
  const dist  = readings.map((r) => r.distance);

  const stat = (arr) => ({
    min:  +Math.min(...arr).toFixed(2),
    max:  +Math.max(...arr).toFixed(2),
    avg:  +(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2),
  });

  return res.json({
    period: `${hours}h`,
    count: readings.length,
    temperature: stat(temps),
    gasLevel:    stat(gas),
    distance:    stat(dist),
  });
});

// DELETE /api/sensors/old?days=30  â€” cleanup old readings
router.delete('/old', auth, async (req, res) => {
  const days = parseInt(req.query.days) || 30;
  const before = new Date(Date.now() - days * 86400 * 1000);
  const { count } = await prisma.sensorReading.deleteMany({
    where: { createdAt: { lt: before } },
  });
  return res.json({ deleted: count });
});


function normalizeQueuedSensor(raw) {
  const temperature = clampNumber(raw.temperature, -50, 100, 0);
  const humidity = clampNumber(raw.humidity, 0, 100, 0);
  const gasLevel = Math.max(0, Math.min(10000, intValue(raw.gas_level ?? raw.gasLevel ?? raw.gas, 0)));
  const isRaining = boolValue(raw.rain ?? raw.isRaining);
  const doorOpen = boolValue(raw.door_open ?? raw.doorOpen ?? raw.door);
  const distance = clampNumber(raw.ultrasonic ?? raw.distance, 0, 1000, 0);
  const createdAt = dateValue(raw.timestamp ?? raw.createdAt ?? raw.created_at) || new Date();
  return {
    temperature,
    humidity,
    gasLevel,
    isRaining,
    distance,
    doorOpen,
    rawPayload: JSON.stringify(raw),
    createdAt,
  };
}

function clampNumber(value, min, max, fallback) {
  const number = Number.parseFloat(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function intValue(value, fallback) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? number : fallback;
}

function boolValue(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
  }
  return false;
}

function dateValue(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

module.exports = router;