-- CreateEnum
CREATE TYPE "ContactEndpointType" AS ENUM ('PHONE');

-- CreateEnum
CREATE TYPE "communicationCallStatus" AS ENUM ('INCOMING', 'CONNECTED', 'COMPLETED', 'MISSED');

-- CreateEnum
CREATE TYPE "CommunicationSessionStatus" AS ENUM ('PENDING', 'ACTIVE', 'EXPIRED');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "mobileNumber" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactEndpoint" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "ContactEndpointType" NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContactEndpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Resource" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Resource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactLink" (
    "id" UUID NOT NULL,
    "resourceId" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContactLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunicationSession" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "resourceId" UUID NOT NULL,
    "contactLinkId" UUID NOT NULL,
    "contactEndpointId" UUID NOT NULL,
    "contactorPhoneNumber" TEXT NOT NULL,
    "status" "CommunicationSessionStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "provider" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunicationSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunicationCall" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "callSid" TEXT NOT NULL,
    "caller" TEXT NOT NULL,
    "callee" TEXT NOT NULL,
    "direction" TEXT,
    "status" "communicationCallStatus" NOT NULL,
    "providerStatus" TEXT,
    "duractionSec" INTEGER,
    "incomingAt" TIMESTAMP(3),
    "connectedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunicationCall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EdesyWebhookEvent" (
    "id" UUID NOT NULL,
    "event" TEXT NOT NULL,
    "reference" TEXT,
    "callSid" TEXT,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "EdesyWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_mobileNumber_key" ON "User"("mobileNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ContactEndpoint_userId_key" ON "ContactEndpoint"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ContactLink_token_key" ON "ContactLink"("token");

-- CreateIndex
CREATE UNIQUE INDEX "CommunicationSession_reference_key" ON "CommunicationSession"("reference");

-- CreateIndex
CREATE INDEX "CommunicationSession_resourceId_idx" ON "CommunicationSession"("resourceId");

-- CreateIndex
CREATE INDEX "CommunicationSession_contactLinkId_idx" ON "CommunicationSession"("contactLinkId");

-- CreateIndex
CREATE INDEX "CommunicationSession_contactEndpointId_idx" ON "CommunicationSession"("contactEndpointId");

-- CreateIndex
CREATE UNIQUE INDEX "CommunicationCall_callSid_key" ON "CommunicationCall"("callSid");

-- CreateIndex
CREATE INDEX "CommunicationCall_sessionId_idx" ON "CommunicationCall"("sessionId");

-- CreateIndex
CREATE INDEX "EdesyWebhookEvent_reference_idx" ON "EdesyWebhookEvent"("reference");

-- CreateIndex
CREATE INDEX "EdesyWebhookEvent_callSid_idx" ON "EdesyWebhookEvent"("callSid");

-- AddForeignKey
ALTER TABLE "ContactEndpoint" ADD CONSTRAINT "ContactEndpoint_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Resource" ADD CONSTRAINT "Resource_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactLink" ADD CONSTRAINT "ContactLink_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "Resource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationSession" ADD CONSTRAINT "CommunicationSession_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "Resource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationSession" ADD CONSTRAINT "CommunicationSession_contactLinkId_fkey" FOREIGN KEY ("contactLinkId") REFERENCES "ContactLink"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationSession" ADD CONSTRAINT "CommunicationSession_contactEndpointId_fkey" FOREIGN KEY ("contactEndpointId") REFERENCES "ContactEndpoint"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationCall" ADD CONSTRAINT "CommunicationCall_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CommunicationSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
