// src/routes/sensors.js
const express = require('express');
const getPrismaClient = require('../config/database');
const auth = require('../middleware/auth');

const router = express.Router();
const prisma = getPrismaClient();

// GET /api/sensors/latest  — most recent reading
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

// GET /api/sensors/stats?hours=24  — min/max/avg per sensor
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

// DELETE /api/sensors/old?days=30  — cleanup old readings
router.delete('/old', auth, async (req, res) => {
  const days = parseInt(req.query.days) || 30;
  const before = new Date(Date.now() - days * 86400 * 1000);
  const { count } = await prisma.sensorReading.deleteMany({
    where: { createdAt: { lt: before } },
  });
  return res.json({ deleted: count });
});

module.exports = router;