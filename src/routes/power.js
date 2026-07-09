const express = require('express');
const getPrismaClient = require('../config/database');

const router = express.Router();
const prisma = getPrismaClient();

const defaultDeviceId = 'power_point_1';
const defaultUnitPrice = 4.2;
const maxReadings = 12000;
const maxBulkSave = Number.parseInt(process.env.POWER_BULK_LIMIT, 10) || 500;

router.get('/history', async (req, res, next) => {
  try {
    const rangeStart = startForRange(req.query.range);
    const where = readingWhere({
      ...req.query,
      from: req.query.from || rangeStart.toISOString(),
    });

    const readings = await prisma.powerReading.findMany({
      where,
      orderBy: { timestamp: 'asc' },
      take: clampInt(req.query.limit, 1, maxReadings, maxReadings),
    });

    return res.json(readings.map(readingResponse));
  } catch (error) {
    return next(error);
  }
});

router.get('/readings', async (req, res, next) => {
  try {
    const limit = clampInt(req.query.limit, 1, maxReadings, maxReadings);
    const where = readingWhere(req.query);

    const readings = await prisma.powerReading.findMany({
      where,
      orderBy: { timestamp: 'desc' },
      take: limit,
    });

    return res.json({
      readings: readings.reverse().map(readingResponse),
      count: readings.length,
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/readings', async (req, res, next) => {
  try {
    const bodyReadings = Array.isArray(req.body)
      ? req.body
      : Array.isArray(req.body.readings)
        ? req.body.readings
        : [req.body];

    const saved = [];
    for (const item of bodyReadings.slice(0, maxBulkSave)) {
      const reading = normalizeReading(item || {});
      const stored = await prisma.powerReading.upsert({
        where: { identityKey: reading.identityKey },
        create: reading,
        update: {
          deviceId: reading.deviceId,
          voltage: reading.voltage,
          current: reading.current,
          powerFactor: reading.powerFactor,
          cableResistance: reading.cableResistance,
          power: reading.power,
          powerLoss: reading.powerLoss,
          energyKwh: reading.energyKwh,
          source: reading.source,
          rawPayload: reading.rawPayload,
          timestamp: reading.timestamp,
        },
      });
      saved.push(readingResponse(stored));
    }

    return res.status(201).json({ saved: saved.length, readings: saved });
  } catch (error) {
    return next(error);
  }
});

router.delete('/readings/old', async (req, res, next) => {
  try {
    const days = clampInt(req.query.days, 1, 3650, 365);
    const before = new Date(Date.now() - days * 86400 * 1000);
    const result = await prisma.powerReading.deleteMany({
      where: { timestamp: { lt: before } },
    });
    return res.json({ deleted: result.count });
  } catch (error) {
    return next(error);
  }
});

router.get('/prices', async (req, res, next) => {
  try {
    const rules = await prisma.energyPriceRule.findMany({
      orderBy: { effectiveDate: 'asc' },
    });
    return res.json(priceHistoryResponse(rules));
  } catch (error) {
    return next(error);
  }
});

router.put('/prices', async (req, res, next) => {
  try {
    const rules = normalizePriceRules(req.body);

    for (const rule of rules) {
      await prisma.energyPriceRule.upsert({
        where: { effectiveDate: rule.effectiveDate },
        create: rule,
        update: { unitPrice: rule.unitPrice },
      });
    }

    const stored = await prisma.energyPriceRule.findMany({
      orderBy: { effectiveDate: 'asc' },
    });
    return res.json(priceHistoryResponse(stored));
  } catch (error) {
    return next(error);
  }
});

router.get('/equipment', async (req, res, next) => {
  try {
    const limit = clampInt(req.query.limit, 1, maxReadings, maxReadings);
    const readings = await prisma.powerReading.findMany({
      where: readingWhere(req.query),
      orderBy: { timestamp: 'asc' },
      take: limit,
    });

    const groups = groupByDevice(readings);
    const equipment = [...groups.entries()].map(([deviceId, items]) => {
      const latest = items[items.length - 1];
      const powers = items.map((item) => item.power);
      const losses = items.map((item) => item.powerLoss);
      return {
        device_id: deviceId,
        reading_count: items.length,
        latest: latest ? readingResponse(latest) : null,
        total_energy_kwh: round(energyForReadings(items), 6),
        average_power_w: round(average(powers), 3),
        peak_power_w: round(Math.max(...powers, 0), 3),
        average_loss_w: round(average(losses), 3),
      };
    });

    return res.json({ equipment, count: equipment.length });
  } catch (error) {
    return next(error);
  }
});

router.get('/summary', async (req, res, next) => {
  try {
    const now = new Date();
    const period = String(req.query.period || 'month').toLowerCase();
    const start =
      period === 'day'
        ? new Date(now.getFullYear(), now.getMonth(), now.getDate())
        : period === 'year'
          ? new Date(now.getFullYear(), 0, 1)
          : new Date(now.getFullYear(), now.getMonth(), 1);

    const where = readingWhere({ ...req.query, from: start.toISOString() });
    const readings = await prisma.powerReading.findMany({
      where,
      orderBy: { timestamp: 'asc' },
      take: maxReadings,
    });
    const rules = await prisma.energyPriceRule.findMany({
      orderBy: { effectiveDate: 'asc' },
    });

    const powers = readings.map((item) => item.power);
    const losses = readings.map((item) => item.powerLoss);
    const energyKwh = energyForDevices(readings);
    const cost = costForPeriod(readings, start, now, rules);
    const latest = readings[readings.length - 1];

    return res.json({
      period,
      start: start.toISOString(),
      end: now.toISOString(),
      reading_count: readings.length,
      latest: latest ? readingResponse(latest) : null,
      energy_kwh: round(energyKwh, 6),
      estimated_cost: round(cost, 4),
      average_power_w: round(average(powers), 3),
      peak_power_w: round(Math.max(...powers, 0), 3),
      average_loss_w: round(average(losses), 3),
      loss_percent: round(lossPercent(average(powers), average(losses)), 3),
      unit_price: priceForDate(now, rules),
    });
  } catch (error) {
    return next(error);
  }
});

function readingWhere(query) {
  const where = {};
  const deviceId = safeText(query.device_id || query.deviceId, '');
  if (deviceId) where.deviceId = deviceId;

  const from = dateValue(query.from);
  const to = dateValue(query.to);
  if (from || to) {
    where.timestamp = {};
    if (from) where.timestamp.gte = from;
    if (to) where.timestamp.lte = to;
  }
  return where;
}

function startForRange(range) {
  const now = new Date();
  switch (String(range || '1d').toLowerCase()) {
    case '1y':
    case 'year':
      return new Date(now.getFullYear(), 0, 1);
    case '1m':
    case 'month':
      return new Date(now.getFullYear(), now.getMonth(), 1);
    case '1w':
    case 'week': {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      start.setDate(start.getDate() - 6);
      return start;
    }
    case '1d':
    case 'day':
    default:
      return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }
}

function normalizeReading(raw) {
  const voltage = numberValue(raw.voltage ?? raw.volt ?? raw.v, 0);
  const current = numberValue(raw.current ?? raw.amp ?? raw.amps ?? raw.i, 0);
  const powerFactor = numberValue(raw.power_factor ?? raw.powerFactor ?? raw.pf, 1);
  const cableResistance = numberValue(
    raw.cable_resistance ?? raw.cableResistance,
    0.05,
  );
  const power = numberValue(
    raw.power ?? raw.watts ?? raw.watt ?? raw.active_power ?? raw.activePower,
    voltage * current * powerFactor,
  );
  const powerLoss = numberValue(
    raw.power_loss ?? raw.powerLoss ?? raw.loss ?? raw.loss_watts ?? raw.lossWatts,
    current * current * cableResistance,
  );
  const energyKwh = numberValue(raw.energy_kwh ?? raw.energyKwh ?? raw.kwh ?? raw.energy, 0);
  const timestamp = dateValue(raw.timestamp) || datePartsValue(raw) || new Date();
  const deviceId = safeText(raw.device_id || raw.deviceId, defaultDeviceId) || defaultDeviceId;
  const source = safeText(raw.source || raw.meter_source || raw.meterSource, 'unknown') || 'unknown';
  const identityKey =
    safeText(raw.identity_key || raw.identityKey, '') ||
    identityKeyFor({ deviceId, timestamp, voltage, current, power, powerLoss });

  return {
    identityKey,
    deviceId,
    voltage,
    current,
    powerFactor,
    cableResistance,
    power,
    powerLoss,
    energyKwh,
    source,
    rawPayload: JSON.stringify(raw),
    timestamp,
  };
}

function readingResponse(reading) {
  const timestamp = new Date(reading.timestamp);
  return {
    id: reading.id,
    identity_key: reading.identityKey,
    device_id: reading.deviceId,
    voltage: reading.voltage,
    current: reading.current,
    power_factor: reading.powerFactor,
    cable_resistance: reading.cableResistance,
    power: reading.power,
    power_loss: reading.powerLoss,
    energy_kwh: reading.energyKwh,
    source: reading.source,
    day: timestamp.getDate(),
    month: timestamp.getMonth() + 1,
    year: timestamp.getFullYear(),
    hour: timestamp.getHours(),
    minute: timestamp.getMinutes(),
    second: timestamp.getSeconds(),
    timestamp: timestamp.toISOString(),
    created_at: reading.createdAt.toISOString(),
  };
}

function normalizePriceRules(body) {
  const source =
    body && body.price_history && !Array.isArray(body.price_history)
      ? body.price_history
      : body;
  const rawRules = Array.isArray(source)
    ? source
    : Array.isArray(source?.price_history)
      ? source.price_history
      : [];
  const rules = rawRules
    .map((item) => {
      const effectiveDate = dateOnly(
        dateValue(item.effective_date || item.effectiveDate || item.date),
      );
      const unitPrice = numberValue(item.unit_price ?? item.unitPrice ?? item.price, NaN);
      if (!effectiveDate || !Number.isFinite(unitPrice) || unitPrice < 0) return null;
      return { effectiveDate, unitPrice };
    })
    .filter(Boolean);

  if (rules.length === 0) {
    const unitPrice = numberValue(body?.unit_price ?? body?.unitPrice ?? body?.value, defaultUnitPrice);
    const effectiveDate = dateOnly(dateValue(body?.effective_date || body?.date) || new Date(1970, 0, 1));
    rules.push({ effectiveDate, unitPrice });
  }

  const byDate = new Map();
  for (const rule of rules) {
    byDate.set(dateKey(rule.effectiveDate), rule);
  }
  return [...byDate.values()].sort((a, b) => a.effectiveDate - b.effectiveDate);
}

function priceHistoryResponse(rules) {
  const normalized = rules.length
    ? rules
    : [{ effectiveDate: new Date(1970, 0, 1), unitPrice: defaultUnitPrice }];
  return {
    current_unit_price: priceForDate(new Date(), normalized),
    price_history: normalized.map((rule) => ({
      effective_date: dateKey(rule.effectiveDate),
      unit_price: rule.unitPrice,
    })),
    count: rules.length,
    saved_at: new Date().toISOString(),
  };
}

function priceForDate(date, rules) {
  if (!rules.length) return defaultUnitPrice;
  const day = dateOnly(date);
  let active = rules[0].unitPrice;
  for (const rule of rules) {
    if (dateOnly(rule.effectiveDate) > day) break;
    active = rule.unitPrice;
  }
  return active;
}

function costForPeriod(readings, start, end, rules) {
  let total = 0;
  let cursor = dateOnly(start);
  while (cursor < end) {
    const next = new Date(cursor);
    next.setDate(next.getDate() + 1);
    const dayEnd = next > end ? end : next;
    const dayReadings = readings.filter(
      (item) => item.timestamp >= cursor && item.timestamp < dayEnd,
    );
    total += energyForDevices(dayReadings) * priceForDate(cursor, rules);
    cursor = next;
  }
  return total;
}

function energyForDevices(readings) {
  let total = 0;
  for (const items of groupByDevice(readings).values()) {
    total += energyForReadings(items);
  }
  return total;
}

function energyForReadings(readings) {
  if (readings.length < 2) return 0;
  const sorted = [...readings].sort((a, b) => a.timestamp - b.timestamp);
  const firstMeter = sorted[0].energyKwh;
  const lastMeter = sorted[sorted.length - 1].energyKwh;
  if (lastMeter > 0 && lastMeter >= firstMeter) return lastMeter - firstMeter;

  let wattHours = 0;
  for (let i = 1; i < sorted.length; i += 1) {
    const previous = sorted[i - 1];
    const current = sorted[i];
    const hours = (current.timestamp - previous.timestamp) / 3600000;
    if (hours <= 0 || hours > 1) continue;
    wattHours += ((previous.power + current.power) / 2) * hours;
  }
  return wattHours / 1000;
}

function groupByDevice(readings) {
  const groups = new Map();
  for (const reading of readings) {
    const items = groups.get(reading.deviceId) || [];
    items.push(reading);
    groups.set(reading.deviceId, items);
  }
  return groups;
}

function identityKeyFor(reading) {
  return [
    reading.deviceId,
    reading.timestamp.toISOString(),
    reading.voltage.toFixed(6),
    reading.current.toFixed(6),
    reading.power.toFixed(6),
    reading.powerLoss.toFixed(6),
  ].join('|');
}

function datePartsValue(raw) {
  const year = intValue(raw.year);
  const month = intValue(raw.month);
  const day = intValue(raw.day ?? raw.date);
  if (!year || !month || !day || year < 1970 || month < 1 || month > 12) return null;
  return new Date(
    year,
    month - 1,
    day,
    intValue(raw.hour) || 0,
    intValue(raw.minute) || 0,
    intValue(raw.second) || 0,
  );
}

function dateValue(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number') {
    const milliseconds = value > 9999999999 ? value : value * 1000;
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateOnly(value) {
  if (!value) return null;
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function dateKey(value) {
  const date = dateOnly(value);
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
}

function numberValue(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function intValue(value) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? number : null;
}

function safeText(value, fallback) {
  const text = String(value || fallback || '').trim();
  return text.length > 100 ? text.slice(0, 100) : text;
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function lossPercent(power, loss) {
  return power <= 0 ? 0 : (loss / (power + loss)) * 100;
}

function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function two(value) {
  return String(value).padStart(2, '0');
}

module.exports = router;
