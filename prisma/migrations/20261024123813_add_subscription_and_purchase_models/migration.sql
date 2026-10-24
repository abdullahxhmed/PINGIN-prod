-- CreateEnum
CREATE TYPE "SubscriptionTier" AS ENUM ('BASIC', 'PLUS');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PurchasePackType" AS ENUM ('PACK_179', 'PACK_499', 'PLUS_RENEWAL', 'CUSTOM');

-- CreateEnum
CREATE TYPE "PurchaseStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'REFUNDED');

-- AlterEnum
ALTER TYPE "QrTagStatus" ADD VALUE 'SUSPENDED';

-- CreateTable
CREATE TABLE "Subscription" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tier" "SubscriptionTier" NOT NULL DEFAULT 'BASIC',
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "maxActiveTags" INTEGER NOT NULL DEFAULT 2,
    "hasWhatsappAlerts" BOOLEAN NOT NULL DEFAULT false,
    "hasAnalytics" BOOLEAN NOT NULL DEFAULT false,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "autoRenew" BOOLEAN NOT NULL DEFAULT false,
    "sourcePack" "PurchasePackType",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionPurchase" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "packType" "PurchasePackType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "tagsIncluded" INTEGER NOT NULL DEFAULT 1,
    "plusDurationMonths" INTEGER NOT NULL DEFAULT 12,
    "status" "PurchaseStatus" NOT NULL DEFAULT 'PENDING',
    "paymentProvider" TEXT,
    "providerOrderId" TEXT,
    "providerPaymentId" TEXT,
    "metadata" JSONB,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionPurchase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_userId_key" ON "Subscription"("userId");

-- CreateIndex
CREATE INDEX "Subscription_status_idx" ON "Subscription"("status");

-- CreateIndex
CREATE INDEX "Subscription_expiresAt_idx" ON "Subscription"("expiresAt");

-- CreateIndex
CREATE INDEX "SubscriptionPurchase_userId_idx" ON "SubscriptionPurchase"("userId");

-- CreateIndex
CREATE INDEX "SubscriptionPurchase_status_idx" ON "SubscriptionPurchase"("status");

-- CreateIndex
CREATE INDEX "SubscriptionPurchase_providerOrderId_idx" ON "SubscriptionPurchase"("providerOrderId");

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionPurchase" ADD CONSTRAINT "SubscriptionPurchase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
