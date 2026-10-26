-- CreateEnum
CREATE TYPE "PrintBatchStatus" AS ENUM ('GENERATED', 'PRINTING', 'STOCKED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "QrTagStockState" ADD VALUE 'GENERATED';
ALTER TYPE "QrTagStockState" ADD VALUE 'SENT_TO_PRINT';

-- AlterTable
ALTER TABLE "QrTagInventory" ADD COLUMN     "printBatchId" UUID,
ALTER COLUMN "state" SET DEFAULT 'GENERATED';

-- CreateTable
CREATE TABLE "PrintProfile" (
    "id" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "widthMm" DOUBLE PRECISION NOT NULL,
    "heightMm" DOUBLE PRECISION NOT NULL,
    "shape" TEXT NOT NULL DEFAULT 'CIRCLE',
    "material" TEXT NOT NULL,
    "finish" TEXT NOT NULL,
    "bleedMm" DOUBLE PRECISION NOT NULL DEFAULT 2.0,
    "safeMarginMm" DOUBLE PRECISION NOT NULL DEFAULT 3.0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrintProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrintTemplate" (
    "id" UUID NOT NULL,
    "profileId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "qrXPosition" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "qrYPosition" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "qrSizeMm" DOUBLE PRECISION NOT NULL DEFAULT 30.0,
    "tagNumberPosition" TEXT NOT NULL DEFAULT 'BELOW_QR',
    "typographyJson" JSONB,
    "brandingAssets" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrintTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrintBatch" (
    "id" UUID NOT NULL,
    "batchNumber" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "status" "PrintBatchStatus" NOT NULL DEFAULT 'GENERATED',
    "vendorName" TEXT,
    "quantityRequested" INTEGER NOT NULL,
    "quantityReceived" INTEGER NOT NULL DEFAULT 0,
    "quantityDefective" INTEGER NOT NULL DEFAULT 0,
    "profileId" UUID,
    "templateId" UUID,
    "profileSnapshot" JSONB,
    "templateSnapshot" JSONB,
    "dispatchedAt" TIMESTAMP(3),
    "stockedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrintBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PrintProfile_sku_key" ON "PrintProfile"("sku");

-- CreateIndex
CREATE INDEX "PrintProfile_sku_idx" ON "PrintProfile"("sku");

-- CreateIndex
CREATE INDEX "PrintTemplate_profileId_isDefault_idx" ON "PrintTemplate"("profileId", "isDefault");

-- CreateIndex
CREATE UNIQUE INDEX "PrintBatch_batchNumber_key" ON "PrintBatch"("batchNumber");

-- CreateIndex
CREATE INDEX "PrintBatch_sku_status_idx" ON "PrintBatch"("sku", "status");

-- CreateIndex
CREATE INDEX "QrTagInventory_printBatchId_idx" ON "QrTagInventory"("printBatchId");

-- AddForeignKey
ALTER TABLE "PrintTemplate" ADD CONSTRAINT "PrintTemplate_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "PrintProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintBatch" ADD CONSTRAINT "PrintBatch_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "PrintProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintBatch" ADD CONSTRAINT "PrintBatch_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "PrintTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QrTagInventory" ADD CONSTRAINT "QrTagInventory_printBatchId_fkey" FOREIGN KEY ("printBatchId") REFERENCES "PrintBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
