// src/routes/alerts.js
const express = require('express');
const auth = require('../middleware/auth');
const alertService = require('../services/alertService');
const getPrismaClient = require('../config/database');

const router = express.Router();
const prisma = getPrismaClient();

// GET /api/alerts?page=1&limit=20&unread=true
router.get('/', auth, async (req, res) => {
  const result = await alertService.getAlerts({
    userId: req.user.id,
    page: parseInt(req.query.page) || 1,
    limit: parseInt(req.query.limit) || 20,
    unreadOnly: req.query.unread === 'true',
  });
  return res.json(result);
});

// GET /api/alerts/unread-count
router.get('/unread-count', auth, async (req, res) => {
  const count = await prisma.alert.count({
    where: { userId: req.user.id, isRead: false },
  });
  return res.json({ count });
});

// PATCH /api/alerts/:id/read
router.patch('/:id/read', auth, async (req, res) => {
  const alert = await alertService.markRead(req.params.id, req.user.id);
  return res.json(alert);
});

// POST /api/alerts/mark-all-read
router.post('/mark-all-read', auth, async (req, res) => {
  const result = await alertService.markAllRead(req.user.id);
  return res.json({ updated: result.count });
});

// GET /api/alerts/thresholds
router.get('/thresholds', auth, async (req, res) => {
  const t = await prisma.alertThreshold.findUnique({ where: { userId: req.user.id } });
  return res.json(t ?? {});
});

// PUT /api/alerts/thresholds
router.put('/thresholds', auth, async (req, res) => {
  const { temperatureMax, gasLevelMax, ultrasonicMin } = req.body;
  const data = {};
  if (temperatureMax !== undefined) data.temperatureMax = parseFloat(temperatureMax);
  if (gasLevelMax !== undefined)    data.gasLevelMax    = parseInt(gasLevelMax);
  if (ultrasonicMin !== undefined)  data.ultrasonicMin  = parseFloat(ultrasonicMin);

  const updated = await prisma.alertThreshold.upsert({
    where: { userId: req.user.id },
    update: data,
    create: { userId: req.user.id, ...data },
  });
  return res.json(updated);
});

module.exports = router;