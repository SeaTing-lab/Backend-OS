-- Power readings and price rules used by the Flutter energy analysis screen.
CREATE TABLE "PowerReading" (
    "id" TEXT NOT NULL,
    "identityKey" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL DEFAULT 'power_point_1',
    "voltage" DOUBLE PRECISION NOT NULL,
    "current" DOUBLE PRECISION NOT NULL,
    "powerFactor" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "cableResistance" DOUBLE PRECISION NOT NULL DEFAULT 0.05,
    "power" DOUBLE PRECISION NOT NULL,
    "powerLoss" DOUBLE PRECISION NOT NULL,
    "energyKwh" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "rawPayload" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PowerReading_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PowerReading_identityKey_key" ON "PowerReading"("identityKey");
CREATE INDEX "PowerReading_timestamp_idx" ON "PowerReading"("timestamp");
CREATE INDEX "PowerReading_deviceId_timestamp_idx" ON "PowerReading"("deviceId", "timestamp");

CREATE TABLE "EnergyPriceRule" (
    "id" SERIAL NOT NULL,
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "unitPrice" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EnergyPriceRule_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EnergyPriceRule_effectiveDate_key" ON "EnergyPriceRule"("effectiveDate");
CREATE INDEX "EnergyPriceRule_effectiveDate_idx" ON "EnergyPriceRule"("effectiveDate");
