/*
  Warnings:

  - A unique constraint covering the columns `[resourceId]` on the table `ContactLink` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateTable
CREATE TABLE "OtpVerification" (
    "id" UUID NOT NULL,
    "mobileNumber" TEXT NOT NULL,
    "otpHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OtpVerification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ContactLink_resourceId_key" ON "ContactLink"("resourceId");
