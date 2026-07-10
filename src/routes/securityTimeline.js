const crypto = require('crypto');
const express = require('express');
const fs = require('fs/promises');
const path = require('path');

const router = express.Router();

const uploadRoot = path.join(__dirname, '..', '..', 'uploads');
const timelineDir = path.join(uploadRoot, 'security-timeline');
const indexPath = path.join(timelineDir, 'events.json');
const maxEvents = Number.parseInt(process.env.SECURITY_TIMELINE_LIMIT, 10) || 500;

router.get('/', async (req, res, next) => {
  try {
    const events = await readEvents();
    return res.json({ events, count: events.length });
  } catch (error) {
    return next(error);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const input = Array.isArray(req.body)
      ? req.body
      : Array.isArray(req.body.events)
        ? req.body.events
        : [req.body];

    const incoming = input.map(normalizeEvent).filter(Boolean);
    const events = await readEvents();
    const byId = new Map(events.map((event) => [event.id, event]));

    for (const event of incoming) {
      byId.set(event.id, { ...byId.get(event.id), ...event });
    }

    const merged = sortAndTrim([...byId.values()]);
    await writeEvents(merged);

    return res.status(201).json({
      saved: incoming.length,
      events: incoming,
      count: merged.length,
    });
  } catch (error) {
    return next(error);
  }
});

router.delete('/', async (req, res, next) => {
  try {
    await writeEvents([]);
    return res.json({ deleted: true });
  } catch (error) {
    return next(error);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const events = await readEvents();
    const filtered = events.filter((event) => event.id !== req.params.id);
    await writeEvents(filtered);
    return res.json({ deleted: events.length !== filtered.length, id: req.params.id });
  } catch (error) {
    return next(error);
  }
});

async function ensureStore() {
  await fs.mkdir(timelineDir, { recursive: true });
  try {
    await fs.access(indexPath);
  } catch {
    await fs.writeFile(indexPath, '[]');
  }
}

async function readEvents() {
  await ensureStore();
  const raw = await fs.readFile(indexPath, 'utf8');
  const events = JSON.parse(raw || '[]');
  return Array.isArray(events) ? sortAndTrim(events.map(normalizeEvent).filter(Boolean)) : [];
}

async function writeEvents(events) {
  await ensureStore();
  await fs.writeFile(indexPath, JSON.stringify(sortAndTrim(events), null, 2));
}

function normalizeEvent(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const timestamp = dateValue(raw.timestamp) || new Date().toISOString();
  const id = safeText(raw.id, '') || `${Date.parse(timestamp)}_${crypto.randomBytes(4).toString('hex')}`;
  return {
    id,
    type: safeText(raw.type, 'system'),
    title: safeText(raw.title, 'Security event'),
    description: safeText(raw.description, ''),
    severity: safeText(raw.severity, 'info'),
    timestamp,
    imagePath: safeText(raw.imagePath || raw.image_path, ''),
    imageUrl: safeText(raw.imageUrl || raw.image_url || raw.remoteUrl || raw.remote_url, ''),
    remoteId: safeText(raw.remoteId || raw.remote_id, ''),
    source: safeText(raw.source, ''),
    syncedAt: new Date().toISOString(),
  };
}

function sortAndTrim(events) {
  return events
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, maxEvents);
}

function safeText(value, fallback) {
  const text = String(value || fallback || '').trim();
  return text.length > 500 ? text.slice(0, 500) : text;
}

function dateValue(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

module.exports = router;
