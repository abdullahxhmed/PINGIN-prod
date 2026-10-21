/*
  Warnings:

  - A unique constraint covering the columns `[phoneLookup]` on the table `ContactEndpoint` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `phoneEncrypted` to the `ContactEndpoint` table without a default value. This is not possible if the table is not empty.
  - Added the required column `phoneLookup` to the `ContactEndpoint` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "QrTagOrigin" AS ENUM ('PREPRINTED_INVENTORY', 'GENERATED_FOR_RESOURCE');

-- CreateEnum
CREATE TYPE "QrTagStatus" AS ENUM ('UNASSIGNED', 'ASSIGNED', 'REVOKED');

-- CreateEnum
CREATE TYPE "QrAssignmentMethod" AS ENUM ('USER_PAIRED', 'SYSTEM_BOUND');

-- AlterTable
ALTER TABLE "ContactEndpoint" ADD COLUMN     "phoneEncrypted" TEXT,
ADD COLUMN     "phoneLookup" TEXT;

-- CreateTable
CREATE TABLE "QrTag" (
    "id" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "origin" "QrTagOrigin" NOT NULL,
    "status" "QrTagStatus" NOT NULL DEFAULT 'UNASSIGNED',
    "resourceId" UUID,
    "assignmentMethod" "QrAssignmentMethod",
    "assignedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QrTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QrAssignment" (
    "id" TEXT NOT NULL,
    "qrTagId" UUID NOT NULL,
    "resourceId" UUID NOT NULL,
    "method" "QrAssignmentMethod" NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unassignedAt" TIMESTAMP(3),

    CONSTRAINT "QrAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "QrTag_tokenHash_key" ON "QrTag"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "QrTag_resourceId_key" ON "QrTag"("resourceId");

-- CreateIndex
CREATE INDEX "QrAssignment_qrTagId_assignedAt_idx" ON "QrAssignment"("qrTagId", "assignedAt");

-- CreateIndex
CREATE INDEX "QrAssignment_resourceId_assignedAt_idx" ON "QrAssignment"("resourceId", "assignedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ContactEndpoint_phoneLookup_key" ON "ContactEndpoint"("phoneLookup");

-- AddForeignKey
ALTER TABLE "QrTag" ADD CONSTRAINT "QrTag_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "Resource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QrAssignment" ADD CONSTRAINT "QrAssignment_qrTagId_fkey" FOREIGN KEY ("qrTagId") REFERENCES "QrTag"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QrAssignment" ADD CONSTRAINT "QrAssignment_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "Resource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
