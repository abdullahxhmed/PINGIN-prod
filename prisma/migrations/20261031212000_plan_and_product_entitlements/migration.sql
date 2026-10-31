-- AlterEnum ProductType: Add DIGITAL_ACCESS and REPLACEMENT_PACK
ALTER TYPE "ProductType" ADD VALUE IF NOT EXISTS 'DIGITAL_ACCESS';
ALTER TYPE "ProductType" ADD VALUE IF NOT EXISTS 'REPLACEMENT_PACK';

-- CreateTable Plan
CREATE TABLE IF NOT EXISTS "Plan" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tagQuota" INTEGER NOT NULL DEFAULT 4,
    "durationDays" INTEGER NOT NULL DEFAULT 365,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Plan_code_key" ON "Plan"("code");

-- AlterTable ProductComponent: Add planId
ALTER TABLE "ProductComponent" ADD COLUMN IF NOT EXISTS "planId" UUID;
CREATE INDEX IF NOT EXISTS "ProductComponent_planId_idx" ON "ProductComponent"("planId");
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ProductComponent_planId_fkey'
    ) THEN
        ALTER TABLE "ProductComponent" ADD CONSTRAINT "ProductComponent_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- AlterTable SubscriptionGrant: Add planId
ALTER TABLE "SubscriptionGrant" ADD COLUMN IF NOT EXISTS "planId" UUID;
CREATE INDEX IF NOT EXISTS "SubscriptionGrant_planId_idx" ON "SubscriptionGrant"("planId");
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'SubscriptionGrant_planId_fkey'
    ) THEN
        ALTER TABLE "SubscriptionGrant" ADD CONSTRAINT "SubscriptionGrant_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- AlterTable Subscription: Add planId
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "planId" UUID;
CREATE INDEX IF NOT EXISTS "Subscription_planId_idx" ON "Subscription"("planId");
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'Subscription_planId_fkey'
    ) THEN
        ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

