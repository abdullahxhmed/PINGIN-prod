-- CreateEnum
CREATE TYPE "VisitSource" AS ENUM ('QR_SCAN', 'SHARE', 'DIRECT');

-- CreateEnum
CREATE TYPE "DeviceType" AS ENUM ('MOBILE', 'DESKTOP', 'TABLET', 'UNKNOWN');

-- AlterTable
ALTER TABLE "CommunicationSession" ADD COLUMN     "visitId" VARCHAR(64);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "lastSeenAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "TagVisit" (
    "id" UUID NOT NULL,
    "visitId" VARCHAR(64) NOT NULL,
    "resourceId" UUID NOT NULL,
    "qrTagId" UUID,
    "source" "VisitSource" NOT NULL DEFAULT 'DIRECT',
    "deviceType" "DeviceType" NOT NULL DEFAULT 'UNKNOWN',
    "os" VARCHAR(20),
    "browser" VARCHAR(20),
    "ipHash" VARCHAR(16),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TagVisit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TagVisit_visitId_key" ON "TagVisit"("visitId");

-- CreateIndex
CREATE INDEX "TagVisit_resourceId_createdAt_idx" ON "TagVisit"("resourceId", "createdAt");

-- CreateIndex
CREATE INDEX "TagVisit_createdAt_idx" ON "TagVisit"("createdAt");

-- CreateIndex
CREATE INDEX "CommunicationSession_visitId_idx" ON "CommunicationSession"("visitId");

-- AddForeignKey
ALTER TABLE "TagVisit" ADD CONSTRAINT "TagVisit_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "Resource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TagVisit" ADD CONSTRAINT "TagVisit_qrTagId_fkey" FOREIGN KEY ("qrTagId") REFERENCES "QrTag"("id") ON DELETE SET NULL ON UPDATE CASCADE;
