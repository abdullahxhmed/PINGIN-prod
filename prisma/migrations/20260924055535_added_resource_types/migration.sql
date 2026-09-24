/*
  Warnings:

  - You are about to drop the column `duractionSec` on the `CommunicationCall` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "ResourceType" AS ENUM ('VEHICLE', 'PROPERTY', 'EQUIPMENT', 'OTHER');

-- AlterTable
ALTER TABLE "CommunicationCall" DROP COLUMN "duractionSec",
ADD COLUMN     "durationSec" INTEGER;

-- AlterTable
ALTER TABLE "Resource" ADD COLUMN     "type" "ResourceType";
