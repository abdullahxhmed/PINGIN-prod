-- AlterTable
ALTER TABLE "QrTag" ADD COLUMN "tagNumber" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "QrTag_tagNumber_key" ON "QrTag"("tagNumber");
