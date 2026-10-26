import { WebhookProcessingStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { reconcileCapturedPayment, reconcileFailedPayment } from "../orders/orders.services.js";

/**
 * Claims and processes a specific WebhookInbox event with safe state transitions and retry backoff.
 */
export const processWebhookInboxRecord = async (inboxId: string): Promise<void> => {
  const inbox = await prisma.webhookInbox.findUnique({
    where: { id: inboxId },
  });

  if (!inbox || inbox.status === WebhookProcessingStatus.PROCESSED) {
    return;
  }

  // Claim the record
  await prisma.webhookInbox.update({
    where: { id: inboxId },
    data: {
      status: WebhookProcessingStatus.PROCESSING,
      attempts: { increment: 1 },
    },
  });

  try {
    const payload = inbox.payload as any;
    const eventType = inbox.eventType;

    if (eventType === "payment.captured") {
      const paymentEntity = payload?.payload?.payment?.entity;
      if (!paymentEntity) {
        throw new Error("Malformed payment.captured payload: missing payment.entity");
      }

      const { id: providerPaymentId, order_id: providerOrderId, amount, currency } = paymentEntity;
      if (!providerOrderId || !providerPaymentId || typeof amount !== "number") {
        throw new Error("Malformed payment.entity: missing order_id, payment id, or amount");
      }

      await reconcileCapturedPayment({
        providerOrderId,
        providerPaymentId,
        amount,
        currency,
        rawPayload: payload,
      });
    } else if (eventType === "payment.failed") {
      const paymentEntity = payload?.payload?.payment?.entity;
      if (paymentEntity?.order_id) {
        await reconcileFailedPayment({
          providerOrderId: paymentEntity.order_id,
          providerPaymentId: paymentEntity.id,
          failureCode: paymentEntity.error_code,
          failureDescription: paymentEntity.error_description,
          rawPayload: payload,
        });
      }
    }

    // Mark as processed
    await prisma.webhookInbox.update({
      where: { id: inboxId },
      data: {
        status: WebhookProcessingStatus.PROCESSED,
        processedAt: new Date(),
        lastError: null,
      },
    });
  } catch (err: any) {
    const nextAttempts = inbox.attempts + 1;
    const isExhausted = nextAttempts >= 5;

    // Exponential backoff: 2^attempts * 1000ms
    const backoffMs = Math.min(Math.pow(2, nextAttempts) * 1000, 300000); // max 5 min
    const nextAttemptAt = new Date(Date.now() + backoffMs);

    await prisma.webhookInbox.update({
      where: { id: inboxId },
      data: {
        status: isExhausted ? WebhookProcessingStatus.DEAD_LETTER : WebhookProcessingStatus.RETRY,
        lastError: err.message || "Unknown processing error",
        nextAttemptAt: isExhausted ? null : nextAttemptAt,
      },
    });

    console.error(`WebhookInbox processing failed for ID ${inboxId}:`, err);
  }
};

/**
 * Periodically claims and processes pending or retryable webhook inbox events.
 */
export const processPendingWebhookInboxBatch = async (batchSize = 10): Promise<number> => {
  const now = new Date();

  const claimable = await prisma.webhookInbox.findMany({
    where: {
      OR: [
        { status: WebhookProcessingStatus.PENDING },
        {
          status: WebhookProcessingStatus.RETRY,
          nextAttemptAt: { lte: now },
        },
      ],
    },
    orderBy: { receivedAt: "asc" },
    take: batchSize,
  });

  for (const item of claimable) {
    await processWebhookInboxRecord(item.id);
  }

  return claimable.length;
};
