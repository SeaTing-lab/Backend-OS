const crypto = require('crypto');
const express = require('express');
const getPrismaClient = require('../config/database');

const router = express.Router();
const prisma = getPrismaClient();

const maxImageBytes =
  Number.parseInt(process.env.PHOTO_MAX_BYTES, 10) || 8 * 1024 * 1024;
const maxPhotos = Number.parseInt(process.env.PHOTO_HISTORY_LIMIT, 10) || 1000;

const mimeExt = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

router.get('/', async (req, res, next) => {
  try {
    const limit = clampInt(req.query.limit, 1, maxPhotos, maxPhotos);
    const photos = await prisma.photo.findMany({
      orderBy: { timestamp: 'desc' },
      take: limit,
    });
    return res.json({
      photos: photos.map((photo) => publicPhoto(req, photo)),
      count: photos.length,
      storage: 'database',
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const photo = await prisma.photo.findUnique({
      where: { id: req.params.id },
    });
    if (!photo) return res.status(404).json({ error: 'Photo not found' });
    return res.json(publicPhoto(req, photo));
  } catch (error) {
    return next(error);
  }
});

router.get('/:id/file', async (req, res, next) => {
  try {
    const photo = await prisma.photo.findUnique({
      where: { id: req.params.id },
    });
    if (!photo) return res.status(404).json({ error: 'Photo not found' });

    const buffer = Buffer.from(photo.imageBase64, 'base64');
    res.setHeader('Content-Type', photo.mimeType);
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    return res.end(buffer);
  } catch (error) {
    return next(error);
  }
});

router.post('/upload', async (req, res, next) => {
  try {
    const imageBase64 = req.body.imageBase64 || req.body.image_base64;
    const mimeType = normalizeMime(req.body.mimeType || req.body.mime_type);
    if (!imageBase64 || !mimeType) {
      return res
        .status(400)
        .json({ error: 'imageBase64 and mimeType are required' });
    }

    const payload = normalizeBase64(imageBase64);
    const imageBuffer = Buffer.from(payload, 'base64');
    if (imageBuffer.length === 0) {
      return res.status(400).json({ error: 'Image is empty' });
    }
    if (imageBuffer.length > maxImageBytes) {
      return res.status(413).json({ error: 'Image is too large' });
    }

    const now = new Date();
    const id = safeId(req.body.id) || `${now.getTime()}_${crypto.randomBytes(5).toString('hex')}`;
    const filename = `${id}.${mimeExt[mimeType]}`;
    const data = {
      id,
      filename,
      mimeType,
      size: imageBuffer.length,
      imageBase64: payload,
      timestamp: dateValue(req.body.timestamp) || now,
      distanceCm: numberValue(req.body.distanceCm ?? req.body.distance_cm),
      thresholdCm: numberValue(req.body.thresholdCm ?? req.body.threshold_cm),
      source: safeText(req.body.source, 'ultrasonic'),
      cameraSource: safeText(req.body.cameraSource || req.body.camera_source, 'phone'),
    };

    const photo = await prisma.photo.upsert({
      where: { id },
      create: data,
      update: {
        filename: data.filename,
        mimeType: data.mimeType,
        size: data.size,
        imageBase64: data.imageBase64,
        timestamp: data.timestamp,
        distanceCm: data.distanceCm,
        thresholdCm: data.thresholdCm,
        source: data.source,
        cameraSource: data.cameraSource,
      },
    });

    return res.status(201).json({ photo: publicPhoto(req, photo) });
  } catch (error) {
    return next(error);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const result = await prisma.photo.deleteMany({
      where: { id: req.params.id },
    });
    if (result.count === 0) {
      return res.status(404).json({ error: 'Photo not found' });
    }
    return res.json({ deleted: true, id: req.params.id });
  } catch (error) {
    return next(error);
  }
});

function publicPhoto(req, photo) {
  return {
    id: photo.id,
    filename: photo.filename,
    mimeType: photo.mimeType,
    size: photo.size,
    timestamp: photo.timestamp.toISOString(),
    distanceCm: photo.distanceCm,
    thresholdCm: photo.thresholdCm,
    source: photo.source,
    cameraSource: photo.cameraSource,
    createdAt: photo.createdAt.toISOString(),
    updatedAt: photo.updatedAt.toISOString(),
    url: absoluteUrl(req, `/api/photos/${encodeURIComponent(photo.id)}/file`),
  };
}

function absoluteUrl(req, relativePath) {
  const publicBase = process.env.PUBLIC_BASE_URL;
  const base = publicBase || `${req.protocol}://${req.get('host')}`;
  return `${base.replace(/\/$/, '')}${relativePath}`;
}

function normalizeMime(value) {
  const mimeType = String(value || '').toLowerCase();
  return mimeExt[mimeType] ? mimeType : null;
}

function normalizeBase64(value) {
  const text = String(value);
  return text.includes(',') ? text.split(',').pop() : text;
}

function safeId(value) {
  const id = String(value || '').trim();
  return /^[a-zA-Z0-9_-]{3,120}$/.test(id) ? id : '';
}

function safeText(value, fallback) {
  const text = String(value || fallback).trim();
  return text.length > 80 ? text.slice(0, 80) : text;
}

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function dateValue(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function clampInt(value, min, max, fallback) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

module.exports = router;
