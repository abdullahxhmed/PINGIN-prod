/*
  Warnings:

  - Added the required column `type` to the `CommunicationSession` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "CommunicationSessionType" AS ENUM ('CALL', 'ALERT', 'MESSAGE');

-- AlterTable
ALTER TABLE "CommunicationSession" ADD COLUMN     "type" "CommunicationSessionType" NOT NULL;

-- CreateTable
CREATE TABLE "VehicleDetail" (
    "id" UUID NOT NULL,
    "resourceId" UUID NOT NULL,
    "registrationNum" TEXT,
    "vehicleColour" TEXT,

    CONSTRAINT "VehicleDetail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VehicleDetail_resourceId_key" ON "VehicleDetail"("resourceId");

-- AddForeignKey
ALTER TABLE "VehicleDetail" ADD CONSTRAINT "VehicleDetail_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "Resource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
