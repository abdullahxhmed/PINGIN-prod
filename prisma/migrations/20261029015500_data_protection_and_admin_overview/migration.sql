-- AlterTable User: remove unique constraint on mobileNumber and add unique mobileLookup blind index
DROP INDEX IF EXISTS "User_mobileNumber_key";
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "mobileLookup" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "User_mobileLookup_key" ON "User"("mobileLookup");

-- AlterTable Subscription: add source
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "source" TEXT;

-- AlterTable Order: add deliveredAt timestamp
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "deliveredAt" TIMESTAMP(3);

-- CreateTable AdminAuditLog
CREATE TABLE IF NOT EXISTS "AdminAuditLog" (
    "id" UUID NOT NULL,
    "adminId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AdminAuditLog_adminId_createdAt_idx" ON "AdminAuditLog"("adminId", "createdAt");
CREATE INDEX IF NOT EXISTS "AdminAuditLog_target_idx" ON "AdminAuditLog"("target");

