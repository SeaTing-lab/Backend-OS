const crypto = require('crypto');
const express = require('express');
const fs = require('fs/promises');
const path = require('path');

const router = express.Router();

const uploadRoot = path.join(__dirname, '..', '..', 'uploads');
const photoDir = path.join(uploadRoot, 'photos');
const indexPath = path.join(photoDir, 'photos.json');
const maxImageBytes =
  Number.parseInt(process.env.PHOTO_MAX_BYTES, 10) || 8 * 1024 * 1024;

const mimeExt = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

router.get('/', async (req, res, next) => {
  try {
    const photos = await readPhotos();
    return res.json({
      photos: photos.map((photo) => publicPhoto(req, photo)),
      count: photos.length,
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const photos = await readPhotos();
    const photo = photos.find((item) => item.id === req.params.id);
    if (!photo) return res.status(404).json({ error: 'Photo not found' });
    return res.json(publicPhoto(req, photo));
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

    const imageBuffer = decodeBase64Image(imageBase64);
    if (imageBuffer.length === 0) {
      return res.status(400).json({ error: 'Image is empty' });
    }
    if (imageBuffer.length > maxImageBytes) {
      return res.status(413).json({ error: 'Image is too large' });
    }

    await ensurePhotoStore();

    const now = new Date();
    const id = `${now.getTime()}_${crypto.randomBytes(5).toString('hex')}`;
    const filename = `${id}.${mimeExt[mimeType]}`;
    const filePath = path.join(photoDir, filename);
    await fs.writeFile(filePath, imageBuffer);

    const photo = {
      id,
      filename,
      path: `/uploads/photos/${filename}`,
      mimeType,
      size: imageBuffer.length,
      timestamp: dateValue(req.body.timestamp) || now.toISOString(),
      distanceCm: numberValue(req.body.distanceCm ?? req.body.distance_cm),
      thresholdCm: numberValue(req.body.thresholdCm ?? req.body.threshold_cm),
      source: safeText(req.body.source, 'ultrasonic'),
      cameraSource: safeText(req.body.cameraSource || req.body.camera_source, 'phone'),
      createdAt: now.toISOString(),
    };

    const photos = await readPhotos();
    photos.unshift(photo);
    await writePhotos(photos);

    return res.status(201).json({ photo: publicPhoto(req, photo) });
  } catch (error) {
    return next(error);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const photos = await readPhotos();
    const index = photos.findIndex((item) => item.id === req.params.id);
    if (index === -1) return res.status(404).json({ error: 'Photo not found' });

    const [photo] = photos.splice(index, 1);
    await writePhotos(photos);

    try {
      await fs.unlink(path.join(photoDir, photo.filename));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }

    return res.json({ deleted: true, id: photo.id });
  } catch (error) {
    return next(error);
  }
});

async function ensurePhotoStore() {
  await fs.mkdir(photoDir, { recursive: true });
  try {
    await fs.access(indexPath);
  } catch {
    await fs.writeFile(indexPath, '[]');
  }
}

async function readPhotos() {
  await ensurePhotoStore();
  const raw = await fs.readFile(indexPath, 'utf8');
  const photos = JSON.parse(raw || '[]');
  return Array.isArray(photos)
    ? photos.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    : [];
}

async function writePhotos(photos) {
  await ensurePhotoStore();
  await fs.writeFile(indexPath, JSON.stringify(photos, null, 2));
}

function publicPhoto(req, photo) {
  return {
    ...photo,
    url: absoluteUrl(req, photo.path),
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

function decodeBase64Image(value) {
  const text = String(value);
  const payload = text.includes(',') ? text.split(',').pop() : text;
  return Buffer.from(payload, 'base64');
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
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

module.exports = router;
