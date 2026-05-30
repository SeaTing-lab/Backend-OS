// src/routes/auth.js
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Joi = require('joi');
const getPrismaClient = require('../config/database');

const router = express.Router();
const prisma = getPrismaClient();

const auth = require('../middleware/auth');

const registerSchema = Joi.object({
  email:    Joi.string().email().required(),
  password: Joi.string().min(6).required(),
  name:     Joi.string().optional(),
});

const loginSchema = Joi.object({
  email:    Joi.string().email().required(),
  password: Joi.string().required(),
});

const fcmTokenSchema = Joi.object({
  token: Joi.string().required(),
});

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const { error, value } = registerSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });

  const exists = await prisma.user.findUnique({ where: { email: value.email } });
  if (exists) return res.status(409).json({ error: 'Email already registered' });

  const passwordHash = await bcrypt.hash(value.password, 10);
  const user = await prisma.user.create({
    data: { email: value.email, passwordHash, name: value.name },
  });

  // Create default thresholds for new user
  await prisma.alertThreshold.create({ data: { userId: user.id } });

  const token = jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });

  return res.status(201).json({ token, user: { id: user.id, email: user.email, name: user.name } });
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { error, value } = loginSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });

  const user = await prisma.user.findUnique({ where: { email: value.email } });
  if (!user) return res.status(401).json({ error: 'Invalid email or password' });

  const valid = await bcrypt.compare(value.password, user.passwordHash);
  if (!valid) return res.status(401).json({ error: 'Invalid email or password' });

  const token = jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });

  return res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
});

// PUT /api/auth/fcm-token  (save Firebase push token)
router.put('/fcm-token', auth, async (req, res) => {
  const { error, value } = fcmTokenSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });

  // Users can only update their own FCM token
  await prisma.user.update({ where: { id: req.user.id }, data: { fcmToken: value.token } });
  return res.json({ ok: true });
});

module.exports = router;