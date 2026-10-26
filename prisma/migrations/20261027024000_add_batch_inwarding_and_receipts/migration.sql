-- AlterEnum
ALTER TYPE "PrintBatchStatus" ADD VALUE IF NOT EXISTS 'PARTIALLY_RECEIVED';
ALTER TYPE "PrintBatchStatus" ADD VALUE IF NOT EXISTS 'RECONCILIATION_REQUIRED';
ALTER TYPE "PrintBatchStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';

-- AlterTable
ALTER TABLE "PrintBatch" ADD COLUMN IF NOT EXISTS "variantId" UUID,
ADD COLUMN IF NOT EXISTS "productId" UUID,
ADD COLUMN IF NOT EXISTS "quantityAccepted" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "variantSnapshot" JSONB;

-- CreateTable
CREATE TABLE IF NOT EXISTS "PrintBatchReceipt" (
    "id" UUID NOT NULL,
    "receiptNumber" TEXT NOT NULL,
    "printBatchId" UUID NOT NULL,
    "idempotencyKey" TEXT,
    "receivedQuantity" INTEGER NOT NULL,
    "acceptedQuantity" INTEGER NOT NULL,
    "defectiveQuantity" INTEGER NOT NULL,
    "missingQuantity" INTEGER NOT NULL DEFAULT 0,
    "defectiveTagNumbers" JSONB,
    "receivedBy" TEXT,
    "notes" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrintBatchReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "PrintBatchReceipt_receiptNumber_key" ON "PrintBatchReceipt"("receiptNumber");
CREATE UNIQUE INDEX IF NOT EXISTS "PrintBatchReceipt_idempotencyKey_key" ON "PrintBatchReceipt"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "PrintBatchReceipt_printBatchId_idx" ON "PrintBatchReceipt"("printBatchId");
CREATE INDEX IF NOT EXISTS "PrintBatch_variantId_idx" ON "PrintBatch"("variantId");
CREATE INDEX IF NOT EXISTS "PrintBatch_productId_idx" ON "PrintBatch"("productId");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PrintBatch_variantId_fkey') THEN
        ALTER TABLE "PrintBatch" ADD CONSTRAINT "PrintBatch_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PrintBatch_productId_fkey') THEN
        ALTER TABLE "PrintBatch" ADD CONSTRAINT "PrintBatch_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PrintBatchReceipt_printBatchId_fkey') THEN
        ALTER TABLE "PrintBatchReceipt" ADD CONSTRAINT "PrintBatchReceipt_printBatchId_fkey" FOREIGN KEY ("printBatchId") REFERENCES "PrintBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
