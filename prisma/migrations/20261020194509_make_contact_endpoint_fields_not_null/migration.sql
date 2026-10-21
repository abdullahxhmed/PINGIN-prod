/*
  Warnings:

  - Made the column `phoneEncrypted` on table `ContactEndpoint` required. This step will fail if there are existing NULL values in that column.
  - Made the column `phoneLookup` on table `ContactEndpoint` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "ContactEndpoint" ALTER COLUMN "phoneEncrypted" SET NOT NULL,
ALTER COLUMN "phoneLookup" SET NOT NULL;
