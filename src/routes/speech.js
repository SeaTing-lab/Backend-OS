const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const multer = require('multer');

const router = express.Router();

const uploadDir = path.join(os.tmpdir(), 'sophea-speech');
fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  dest: uploadDir,
  limits: {
    fileSize: Number(process.env.SPEECH_MAX_BYTES || 12 * 1024 * 1024),
  },
});

function normalizeLanguage(value) {
  const text = String(value || 'km').trim().toLowerCase();
  if (!text || text.startsWith('km')) return 'km';
  if (text.startsWith('en')) return 'en';
  return text.split(/[-_]/)[0] || 'km';
}

function khmerPrompt(language) {
  if (language !== 'km') return undefined;
  return [
    'Language: Khmer (km). Sophea AI smart home voice command.',
    'Expected meanings include turn light 1 on, turn light 1 off, all lights on, all lights off, status, camera, door, lock, unlock.',
    'Return only the exact spoken Khmer text when possible.',
  ].join(' ');
}

router.post('/transcribe', upload.single('audio'), async (req, res) => {
  const file = req.file;
  if (!file) {
    return res.status(400).json({ error: 'Missing audio file field named audio.' });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    try { fs.unlinkSync(file.path); } catch (_) {}
    return res.status(500).json({ error: 'OPENAI_API_KEY is not set on the backend.' });
  }

  const language = normalizeLanguage(req.body.language);
  const model = process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-transcribe';

  try {
    const form = new FormData();
    form.append('file', fs.createReadStream(file.path), {
      filename: file.originalname || 'sophea-voice.m4a',
      contentType: file.mimetype || 'audio/mp4',
    });
    form.append('model', model);
    form.append('language', language);
    form.append('response_format', 'json');

    const prompt = khmerPrompt(language);
    if (prompt) form.append('prompt', prompt);

    const response = await axios.post(
      'https://api.openai.com/v1/audio/transcriptions',
      form,
      {
        headers: {
          ...form.getHeaders(),
          Authorization: `Bearer ${apiKey}`,
        },
        maxBodyLength: Infinity,
        timeout: Number(process.env.SPEECH_TIMEOUT_MS || 35000),
      },
    );

    const text = String(response.data?.text || '').trim();
    return res.json({
      text,
      language,
      model,
    });
  } catch (error) {
    const status = error.response?.status;
    const detail =
      error.response?.data?.error?.message ||
      error.response?.data?.message ||
      error.message ||
      'Transcription failed';
    return res.status(status && status < 500 ? status : 502).json({
      error: 'Transcription failed',
      detail,
    });
  } finally {
    try { fs.unlinkSync(file.path); } catch (_) {}
  }
});

module.exports = router;