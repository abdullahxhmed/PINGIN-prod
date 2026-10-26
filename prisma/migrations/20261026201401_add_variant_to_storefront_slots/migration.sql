-- AlterTable
ALTER TABLE "StorefrontSlot" ADD COLUMN     "variantId" UUID;

-- AlterTable
ALTER TABLE "StorefrontSlotHistory" ADD COLUMN     "newVariantId" UUID,
ADD COLUMN     "previousVariantId" UUID;

-- CreateIndex
CREATE INDEX "StorefrontSlot_variantId_idx" ON "StorefrontSlot"("variantId");

-- AddForeignKey
ALTER TABLE "StorefrontSlot" ADD CONSTRAINT "StorefrontSlot_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StorefrontSlotHistory" ADD CONSTRAINT "StorefrontSlotHistory_previousVariantId_fkey" FOREIGN KEY ("previousVariantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StorefrontSlotHistory" ADD CONSTRAINT "StorefrontSlotHistory_newVariantId_fkey" FOREIGN KEY ("newVariantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
