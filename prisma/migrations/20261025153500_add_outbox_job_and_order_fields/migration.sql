-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'RETRY', 'DEAD_LETTER');

-- AlterEnum
ALTER TYPE "OtpPurpose" ADD VALUE 'CLAIM_PURCHASE';

-- AlterEnum
ALTER TYPE "PaymentStatus" ADD VALUE 'RECONCILIATION_REQUIRED';

-- AlterEnum
ALTER TYPE "WebhookProcessingStatus" ADD VALUE 'PROCESSING';
ALTER TYPE "WebhookProcessingStatus" ADD VALUE 'RETRY';
ALTER TYPE "WebhookProcessingStatus" ADD VALUE 'DEAD_LETTER';

-- DropIndex
DROP INDEX IF EXISTS "PaymentTransaction_orderId_idx";

-- DropIndex
DROP INDEX IF EXISTS "PaymentTransaction_razorpayOrderId_key";

-- DropIndex
DROP INDEX IF EXISTS "WebhookInbox_status_receivedAt_idx";

-- AlterTable
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "checkoutIdempotencyKey" TEXT,
ADD COLUMN IF NOT EXISTS "razorpayOrderId" TEXT;

-- AlterTable
ALTER TABLE "PaymentTransaction" ADD COLUMN IF NOT EXISTS "capturedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "failureCode" TEXT;

-- AlterTable
ALTER TABLE "WebhookInbox" DROP COLUMN IF EXISTS "error",
ADD COLUMN IF NOT EXISTS "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "lastError" TEXT,
ADD COLUMN IF NOT EXISTS "nextAttemptAt" TIMESTAMP(3);

ALTER TABLE "WebhookInbox" ALTER COLUMN "provider" SET DEFAULT 'RAZORPAY';

-- CreateTable
CREATE TABLE IF NOT EXISTS "OutboxJob" (
    "id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "completedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutboxJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "OutboxJob_dedupeKey_key" ON "OutboxJob"("dedupeKey");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OutboxJob_status_availableAt_idx" ON "OutboxJob"("status", "availableAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Order_razorpayOrderId_key" ON "Order"("razorpayOrderId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Order_checkoutIdempotencyKey_key" ON "Order"("checkoutIdempotencyKey");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Order_razorpayOrderId_idx" ON "Order"("razorpayOrderId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PaymentTransaction_orderId_status_idx" ON "PaymentTransaction"("orderId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PaymentTransaction_razorpayOrderId_idx" ON "PaymentTransaction"("razorpayOrderId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WebhookInbox_status_nextAttemptAt_receivedAt_idx" ON "WebhookInbox"("status", "nextAttemptAt", "receivedAt");
