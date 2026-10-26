/*
  Warnings:

  - You are about to drop the column `darkImageUrl` on the `Product` table. All the data in the column will be lost.
  - You are about to drop the column `lightImageUrl` on the `Product` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Product" DROP COLUMN "darkImageUrl",
DROP COLUMN "lightImageUrl";
