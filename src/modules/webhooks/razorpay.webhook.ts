import type { Request, Response } from "express";
import asyncHandler from "express-async-handler";
import { WebhookProcessingStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { BadRequestError, UnauthorizedError } from "../../errors/AppError.js";
import { verifyRazorpayWebhookSignature } from "../../integrations/razorpay/razorpay.webhook.js";
import { processWebhookInboxRecord } from "./webhook-inbox.worker.js";

/**
 * Handles incoming Razorpay webhooks.
 *
 * Invariants:
 * 1. Uses the exact raw request body buffer (req.rawBody) for HMAC-SHA256 verification.
 * 2. Unauthenticated requests are rejected immediately.
 * 3. Verified events are persisted to WebhookInbox under a unique event ID constraint before returning 200.
 * 4. Duplicate deliveries are acknowledged immediately without duplicate processing.
 * 5. Processing is decoupled from the HTTP response.
 *
 * POST /api/webhooks/razorpay
 */
export const razorpayWebhookController = asyncHandler(async (req: Request, res: Response) => {
  const signature = req.headers["x-razorpay-signature"] as string | undefined;
  const eventId = (req.headers["x-razorpay-event-id"] as string | undefined) || req.body?.event_id;

  if (!eventId) {
    throw new BadRequestError("Missing Razorpay event identifier (x-razorpay-event-id)");
  }

  // 1. Verify HMAC-SHA256 signature against the raw request body bytes
  const isSignatureValid = verifyRazorpayWebhookSignature(req.rawBody, signature);
  if (!isSignatureValid) {
    throw new UnauthorizedError("Invalid Razorpay webhook signature");
  }

  const eventType = req.body?.event || "unknown";

  // 2. Persist before acknowledge: store in WebhookInbox under unique constraint
  let inboxRecord;
  try {
    inboxRecord = await prisma.webhookInbox.create({
      data: {
        provider: "RAZORPAY",
        eventId,
        eventType,
        payload: req.body,
        status: WebhookProcessingStatus.PENDING,
      },
    });
  } catch (err: any) {
    // Unique constraint violation (P2002) means this event was already durably received
    if (err.code === "P2002") {
      res.status(200).json({ status: "success", message: "Event already recorded", duplicate: true });
      return;
    }
    throw err;
  }

  // 3. Acknowledge promptly (within Razorpay's 5s timeout)
  res.status(200).json({ status: "success", message: "Webhook received", eventId });

  // 4. Asynchronously process the inbox event
  setImmediate(async () => {
    try {
      await processWebhookInboxRecord(inboxRecord.id);
    } catch (workerErr) {
      console.error(`Background processing failed for WebhookInbox ${inboxRecord.id}:`, workerErr);
    }
  });
});
