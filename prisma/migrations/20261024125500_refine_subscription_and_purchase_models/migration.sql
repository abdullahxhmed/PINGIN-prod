-- DropForeignKey
ALTER TABLE "Subscription" DROP CONSTRAINT "Subscription_userId_fkey";

-- DropForeignKey
ALTER TABLE "SubscriptionPurchase" DROP CONSTRAINT "SubscriptionPurchase_userId_fkey";

-- DropIndex
DROP INDEX "Subscription_expiresAt_idx";

-- DropIndex
DROP INDEX "Subscription_status_idx";

-- DropIndex
DROP INDEX "SubscriptionPurchase_providerOrderId_idx";

-- DropIndex
DROP INDEX "SubscriptionPurchase_status_idx";

-- DropIndex
DROP INDEX "SubscriptionPurchase_userId_idx";

-- AlterTable
ALTER TABLE "Subscription" DROP COLUMN "autoRenew",
DROP COLUMN "sourcePack",
DROP COLUMN "status";

-- AlterTable
ALTER TABLE "SubscriptionPurchase" DROP COLUMN "amount",
ADD COLUMN     "amountPaise" INTEGER NOT NULL,
ALTER COLUMN "tagsIncluded" SET DEFAULT 0,
ALTER COLUMN "plusDurationMonths" SET DEFAULT 0;

-- DropEnum
DROP TYPE "SubscriptionStatus";

-- CreateIndex
CREATE INDEX "Subscription_tier_expiresAt_idx" ON "Subscription"("tier", "expiresAt");

-- CreateIndex
CREATE INDEX "SubscriptionPurchase_userId_createdAt_idx" ON "SubscriptionPurchase"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "SubscriptionPurchase_status_createdAt_idx" ON "SubscriptionPurchase"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionPurchase_paymentProvider_providerOrderId_key" ON "SubscriptionPurchase"("paymentProvider", "providerOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionPurchase_paymentProvider_providerPaymentId_key" ON "SubscriptionPurchase"("paymentProvider", "providerPaymentId");

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionPurchase" ADD CONSTRAINT "SubscriptionPurchase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
