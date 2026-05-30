// src/config/database.js
const { PrismaClient } = require('@prisma/client');

// Singleton pattern to prevent connection pool exhaustion
let prisma = null;

function getPrismaClient() {
  if (!prisma) {
    prisma = new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['query', 'info', 'warn', 'error'] : ['error'],
    });
  }
  return prisma;
}

module.exports = getPrismaClient;
