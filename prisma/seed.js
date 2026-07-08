// prisma/seed.js
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

// Seed script can use direct instance since it's a one-off script
const prisma = new PrismaClient();

async function main() {
  // Default devices
  const devices = [
    { id: 'relay_1', name: 'DC Fan',       type: 'relay',    icon: '🌀', channel: 'relay/1',          isOn: false },
    { id: 'relay_2', name: 'Light Bulb A', type: 'relay',    icon: '💡', channel: 'relay/2',          isOn: false },
    { id: 'relay_3', name: 'Light Bulb B', type: 'relay',    icon: '💡', channel: 'relay/3',          isOn: false },
    { id: 'relay_4', name: 'Light Bulb C', type: 'relay',    icon: '💡', channel: 'relay/4',          isOn: false },
    { id: 'buzzer',  name: 'Buzzer',       type: 'actuator', icon: '🔔', channel: 'actuator/buzzer',  isOn: false },
    { id: 'servo',   name: 'Servo Motor',  type: 'actuator', icon: '⚙️', channel: 'actuator/servo',   isOn: false },
    { id: 'camera',  name: 'Camera',       type: 'actuator', icon: '📷', channel: 'actuator/camera',  isOn: true  },
  ];

  for (const d of devices) {
    await prisma.device.upsert({
      where: { id: d.id },
      update: {
        name: d.name,
        type: d.type,
        icon: d.icon,
        channel: d.channel,
      },
      create: d,
    });
  }

  // System state
  await prisma.systemState.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1, mode: 'manual', esp32Online: false },
  });

  // Demo admin user
  const hash = await bcrypt.hash('admin123', 10);
  const user = await prisma.user.upsert({
    where: { email: 'admin@smarthome.local' },
    update: {},
    create: { email: 'admin@smarthome.local', passwordHash: hash, name: 'Admin' },
  });

  await prisma.alertThreshold.upsert({
    where: { userId: user.id },
    update: {},
    create: { userId: user.id },
  });

  console.log('✅ Seed complete');
}

main().catch(console.error).finally(() => prisma.$disconnect());
