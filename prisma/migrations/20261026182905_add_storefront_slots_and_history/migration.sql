-- CreateEnum
CREATE TYPE "StorefrontSlotType" AS ENUM ('BUNDLE', 'INDIVIDUAL');

-- CreateTable
CREATE TABLE "StorefrontSlot" (
    "id" UUID NOT NULL,
    "slotKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "slotType" "StorefrontSlotType" NOT NULL DEFAULT 'INDIVIDUAL',
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "productId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StorefrontSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StorefrontSlotHistory" (
    "id" UUID NOT NULL,
    "slotId" UUID NOT NULL,
    "slotKey" TEXT NOT NULL,
    "slotLabel" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "previousProductId" UUID,
    "newProductId" UUID,
    "changedBy" TEXT,
    "reason" TEXT,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StorefrontSlotHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StorefrontSlot_slotKey_key" ON "StorefrontSlot"("slotKey");

-- CreateIndex
CREATE INDEX "StorefrontSlot_slotType_displayOrder_idx" ON "StorefrontSlot"("slotType", "displayOrder");

-- CreateIndex
CREATE INDEX "StorefrontSlot_active_displayOrder_idx" ON "StorefrontSlot"("active", "displayOrder");

-- CreateIndex
CREATE INDEX "StorefrontSlotHistory_slotId_assignedAt_idx" ON "StorefrontSlotHistory"("slotId", "assignedAt");

-- CreateIndex
CREATE INDEX "StorefrontSlotHistory_slotKey_assignedAt_idx" ON "StorefrontSlotHistory"("slotKey", "assignedAt");

-- AddForeignKey
ALTER TABLE "StorefrontSlot" ADD CONSTRAINT "StorefrontSlot_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StorefrontSlotHistory" ADD CONSTRAINT "StorefrontSlotHistory_previousProductId_fkey" FOREIGN KEY ("previousProductId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StorefrontSlotHistory" ADD CONSTRAINT "StorefrontSlotHistory_newProductId_fkey" FOREIGN KEY ("newProductId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StorefrontSlotHistory" ADD CONSTRAINT "StorefrontSlotHistory_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "StorefrontSlot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
