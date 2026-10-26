-- CreateEnum
CREATE TYPE "PackingSessionStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- AlterEnum
BEGIN;
CREATE TYPE "OrderStatus_new" AS ENUM ('PAYMENT_PENDING', 'PAID', 'PACKING', 'PACKED', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'REFUNDED', 'RECONCILIATION_REQUIRED');
ALTER TABLE "public"."Order" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Order" ALTER COLUMN "status" TYPE "OrderStatus_new" USING ("status"::text::"OrderStatus_new");
ALTER TYPE "OrderStatus" RENAME TO "OrderStatus_old";
ALTER TYPE "OrderStatus_new" RENAME TO "OrderStatus";
DROP TYPE "public"."OrderStatus_old";
ALTER TABLE "Order" ALTER COLUMN "status" SET DEFAULT 'PAYMENT_PENDING';
COMMIT;

-- CreateTable
CREATE TABLE "PackingSession" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "sessionNumber" INTEGER NOT NULL DEFAULT 1,
    "packedBy" TEXT,
    "status" "PackingSessionStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PackingSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackingScan" (
    "id" UUID NOT NULL,
    "packingSessionId" UUID NOT NULL,
    "orderItemId" UUID NOT NULL,
    "qrTagId" UUID NOT NULL,
    "scannedTagNumber" TEXT NOT NULL,
    "scannedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PackingScan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PackingSession_orderId_status_idx" ON "PackingSession"("orderId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PackingSession_orderId_sessionNumber_key" ON "PackingSession"("orderId", "sessionNumber");

-- Partial Unique Index: Exactly one IN_PROGRESS packing session per order
CREATE UNIQUE INDEX "unique_active_packing_session_per_order" ON "PackingSession"("orderId") WHERE status = 'IN_PROGRESS';

-- CreateIndex
CREATE INDEX "PackingScan_orderItemId_idx" ON "PackingScan"("orderItemId");

-- CreateIndex
CREATE UNIQUE INDEX "PackingScan_packingSessionId_qrTagId_key" ON "PackingScan"("packingSessionId", "qrTagId");

-- AddForeignKey
ALTER TABLE "PackingSession" ADD CONSTRAINT "PackingSession_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackingScan" ADD CONSTRAINT "PackingScan_packingSessionId_fkey" FOREIGN KEY ("packingSessionId") REFERENCES "PackingSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackingScan" ADD CONSTRAINT "PackingScan_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackingScan" ADD CONSTRAINT "PackingScan_qrTagId_fkey" FOREIGN KEY ("qrTagId") REFERENCES "QrTag"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
