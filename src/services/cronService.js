// src/services/cronService.js
const cron = require('node-cron');
const getPrismaClient = require('../config/database');
const logger = require('../config/logger');
const mqttService = require('./mqttService');

const prisma = getPrismaClient();

function start() {
  // ── Cleanup old sensor readings every day at 2am ───────────────────────
  cron.schedule('0 2 * * *', async () => {
    const cutoff = new Date(Date.now() - 30 * 86400 * 1000);
    const { count } = await prisma.sensorReading.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    logger.info(`[CRON] Cleaned up ${count} old sensor readings`);
  });

  // ── Cleanup old alerts every week ─────────────────────────────────────
  cron.schedule('0 3 * * 0', async () => {
    const cutoff = new Date(Date.now() - 90 * 86400 * 1000);
    const { count } = await prisma.alert.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    logger.info(`[CRON] Cleaned up ${count} old alerts`);
  });

  // ── Auto mode: turn off lights at midnight, on at 6pm ─────────────────
  cron.schedule('0 0 * * *', async () => {
    const state = await prisma.systemState.findUnique({ where: { id: 1 } });
    if (state?.mode !== 'automatic') return;

    logger.info('[CRON] Auto mode: turning off all lights (midnight)');
    const relays = await prisma.device.findMany({ where: { type: 'relay' } });
    for (const r of relays) {
      mqttService.publishCommand(r.channel, false);
      await prisma.device.update({ where: { id: r.id }, data: { isOn: false } });
    }
  });

  cron.schedule('0 18 * * *', async () => {
    const state = await prisma.systemState.findUnique({ where: { id: 1 } });
    if (state?.mode !== 'automatic') return;

    logger.info('[CRON] Auto mode: turning on lights (6pm)');
    const relays = await prisma.device.findMany({ where: { type: 'relay', id: { in: ['relay_2', 'relay_3'] } } });
    for (const r of relays) {
      mqttService.publishCommand(r.channel, true);
      await prisma.device.update({ where: { id: r.id }, data: { isOn: true } });
    }
  });

  // ── ESP32 watchdog: mark offline if no reading in 30 seconds ──────────
  cron.schedule('*/30 * * * * *', async () => {
    const latest = await prisma.sensorReading.findFirst({ orderBy: { createdAt: 'desc' } });
    if (!latest) return;
    const age = Date.now() - new Date(latest.createdAt).getTime();
    if (age > 30_000) {
      await prisma.systemState.update({ where: { id: 1 }, data: { esp32Online: false } });
    }
  });

  logger.info('[CRON] Scheduled jobs started');
}

module.exports = { start };