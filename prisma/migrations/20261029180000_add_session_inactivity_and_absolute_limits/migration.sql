-- AlterTable RefreshToken: add lastUsedAt and absoluteExpiresAt, and unique constraint on tokenHash
ALTER TABLE "RefreshToken" ADD COLUMN IF NOT EXISTS "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "RefreshToken" ADD COLUMN IF NOT EXISTS "absoluteExpiresAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");
CREATE INDEX IF NOT EXISTS "RefreshToken_tokenHash_idx" ON "RefreshToken"("tokenHash");

-- Backfill existing rows
UPDATE "RefreshToken"
SET "lastUsedAt" = "createdAt",
    "absoluteExpiresAt" = "expiresAt"
WHERE "absoluteExpiresAt" IS NULL;

