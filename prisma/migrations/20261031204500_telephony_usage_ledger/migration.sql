-- AlterTable
ALTER TABLE "CommunicationCall"
  ADD COLUMN IF NOT EXISTS "userId" UUID,
  ADD COLUMN IF NOT EXISTS "resourceId" UUID,
  ADD COLUMN IF NOT EXISTS "qrTagId" UUID,
  ADD COLUMN IF NOT EXISTS "provider" TEXT NOT NULL DEFAULT 'EDESY',
  ADD COLUMN IF NOT EXISTS "actualDurationSeconds" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "billedDurationSeconds" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "providerCostPaise" INTEGER,
  ADD COLUMN IF NOT EXISTS "estimatedCostPaise" INTEGER,
  ADD COLUMN IF NOT EXISTS "currency" TEXT NOT NULL DEFAULT 'INR';

-- AddForeignKeys
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommunicationCall_userId_fkey') THEN
    ALTER TABLE "CommunicationCall" ADD CONSTRAINT "CommunicationCall_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommunicationCall_resourceId_fkey') THEN
    ALTER TABLE "CommunicationCall" ADD CONSTRAINT "CommunicationCall_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "Resource"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommunicationCall_qrTagId_fkey') THEN
    ALTER TABLE "CommunicationCall" ADD CONSTRAINT "CommunicationCall_qrTagId_fkey" FOREIGN KEY ("qrTagId") REFERENCES "QrTag"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CommunicationCall_userId_createdAt_idx" ON "CommunicationCall"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "CommunicationCall_resourceId_idx" ON "CommunicationCall"("resourceId");
CREATE INDEX IF NOT EXISTS "CommunicationCall_qrTagId_idx" ON "CommunicationCall"("qrTagId");
CREATE INDEX IF NOT EXISTS "CommunicationCall_status_createdAt_idx" ON "CommunicationCall"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "CommunicationCall_provider_createdAt_idx" ON "CommunicationCall"("provider", "createdAt");

