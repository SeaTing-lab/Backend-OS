-- Permanent camera photo storage for Sophea/security photo library.
CREATE TABLE IF NOT EXISTS "Photo" (
    "id" TEXT NOT NULL,
    "filename" TEXT,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "imageBase64" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "distanceCm" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "thresholdCm" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'ultrasonic',
    "cameraSource" TEXT NOT NULL DEFAULT 'phone',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Photo_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Photo_timestamp_idx" ON "Photo"("timestamp");
CREATE INDEX IF NOT EXISTS "Photo_createdAt_idx" ON "Photo"("createdAt");
