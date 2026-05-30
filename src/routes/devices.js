// src/routes/devices.js
const express = require('express');
const getPrismaClient = require('../config/database');
const auth = require('../middleware/auth');
const mqttService = require('../services/mqttService');
const wsService = require('../services/wsService');

const router = express.Router();
const prisma = getPrismaClient();

// GET /api/devices  — list all devices with current state
router.get('/', auth, async (req, res) => {
  const devices = await prisma.device.findMany({ orderBy: { id: 'asc' } });
  return res.json(devices);
});

// GET /api/devices/:id
router.get('/:id', auth, async (req, res) => {
  const device = await prisma.device.findUnique({ where: { id: req.params.id } });
  if (!device) return res.status(404).json({ error: 'Device not found' });
  return res.json(device);
});

// PATCH /api/devices/:id  — toggle on/off
router.patch('/:id', auth, async (req, res) => {
  const { isOn } = req.body;
  if (typeof isOn !== 'boolean') {
    return res.status(400).json({ error: 'isOn (boolean) is required' });
  }

  const device = await prisma.device.findUnique({ where: { id: req.params.id } });
  if (!device) return res.status(404).json({ error: 'Device not found' });

  // Publish MQTT command to ESP32
  const published = mqttService.publishCommand(device.channel, isOn);

  // Update DB state
  const updated = await prisma.device.update({
    where: { id: req.params.id },
    data: { isOn },
  });

  // Broadcast device change to all WS clients
  wsService.broadcast({ type: 'device_update', data: updated });

  return res.json({ ...updated, mqtt: published ? 'sent' : 'offline' });
});

// POST /api/devices/all-off  — turn off all relays
router.post('/all-off', auth, async (req, res) => {
  const relays = await prisma.device.findMany({ where: { type: 'relay' } });
  for (const r of relays) {
    mqttService.publishCommand(r.channel, false);
    await prisma.device.update({ where: { id: r.id }, data: { isOn: false } });
  }
  wsService.broadcast({ type: 'all_off', data: {} });
  return res.json({ ok: true, affected: relays.length });
});

// POST /api/devices/all-on  — turn on all relays
router.post('/all-on', auth, async (req, res) => {
  const relays = await prisma.device.findMany({ where: { type: 'relay' } });
  for (const r of relays) {
    mqttService.publishCommand(r.channel, true);
    await prisma.device.update({ where: { id: r.id }, data: { isOn: true } });
  }
  wsService.broadcast({ type: 'all_on', data: {} });
  return res.json({ ok: true, affected: relays.length });
});

module.exports = router;