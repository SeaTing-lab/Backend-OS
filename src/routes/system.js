// src/routes/system.js
const express = require('express');
const getPrismaClient = require('../config/database');
const auth = require('../middleware/auth');
const mqttService = require('../services/mqttService');
const wsService = require('../services/wsService');

const router = express.Router();
const prisma = getPrismaClient();

// GET /api/system/status
router.get('/status', auth, async (req, res) => {
  const state = await prisma.systemState.findUnique({ where: { id: 1 } });
  return res.json({
    ...state,
    mqttConnected: mqttService.isConnected(),
    wsClients: wsService.clientCount(),
  });
});

// PATCH /api/system/mode
router.patch('/mode', auth, async (req, res) => {
  const { mode } = req.body;
  const valid = ['manual', 'automatic', 'google'];
  if (!valid.includes(mode)) {
    return res.status(400).json({ error: `mode must be one of: ${valid.join(', ')}` });
  }

  const updated = await prisma.systemState.update({
    where: { id: 1 },
    data: { mode },
  });

  mqttService.publishMode(mode);
  wsService.broadcast({ type: 'mode_change', data: { mode } });

  return res.json(updated);
});

module.exports = router;