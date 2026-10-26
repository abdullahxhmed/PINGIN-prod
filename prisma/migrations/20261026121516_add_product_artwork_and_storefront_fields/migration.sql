-- DropForeignKey
ALTER TABLE "ReservedTag" DROP CONSTRAINT "ReservedTag_componentId_fkey";

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "darkImageUrl" TEXT,
ADD COLUMN     "displayOrder" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "imageUrl" TEXT,
ADD COLUMN     "isFeatured" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lightImageUrl" TEXT;

-- CreateIndex
CREATE INDEX "Product_displayOrder_createdAt_idx" ON "Product"("displayOrder", "createdAt");

-- AddForeignKey
ALTER TABLE "ReservedTag" ADD CONSTRAINT "ReservedTag_componentId_fkey" FOREIGN KEY ("componentId") REFERENCES "ProductComponent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
