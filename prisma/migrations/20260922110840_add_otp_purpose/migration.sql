/*
  Warnings:

  - Added the required column `purpose` to the `OtpVerification` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "OtpPurpose" AS ENUM ('SIGNUP', 'LOGIN');

-- AlterTable
ALTER TABLE "OtpVerification" ADD COLUMN     "purpose" "OtpPurpose" NOT NULL;
