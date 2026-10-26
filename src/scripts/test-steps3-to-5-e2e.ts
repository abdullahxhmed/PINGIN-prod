import crypto from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { createAtomicReservation } from "../modules/inventory/inventory.services.js";
import { createOrderFromCheckout, getOrderStatus } from "../modules/orders/orders.services.js";
import { verifyRazorpayWebhookSignature } from "../integrations/razorpay/razorpay.webhook.js";
import { processWebhookInboxRecord } from "../modules/webhooks/webhook-inbox.worker.js";
import { requestPurchaseClaimOtp, verifyAndClaimPurchase } from "../modules/claims/claims.services.js";
import { pairQrTag } from "../modules/qr/qr.services.js";
import {
  GrantStatus,
  OrderStatus,
  PaymentStatus,
  QrTagStockState,
  ReservationStatus,
  ResourceType,
  SubscriptionTier,
  WebhookProcessingStatus,
} from "@prisma/client";

async function runSteps3To5Test() {
  console.log("=== STARTING STEPS 3-5 INTEGRATION TEST ===");

  const timestamp = Date.now();
  const testEmail = `guest_${timestamp}@testparkping.com`;
  const testPhone = `98${Math.floor(10000000 + Math.random() * 90000000)}`;

  // Find variant PK-VAR-499-STD
  const variant = await prisma.productVariant.findUniqueOrThrow({
    where: { sku: "PK-VAR-499-STD" },
    include: { components: true },
  });
  console.log(`[1] Found test variant: ${variant.name} (${variant.sku})`);

  // -------------------------------------------------------------
  // Test 1: Step 3 Atomic Checkout & Synchronous Razorpay Order
  // -------------------------------------------------------------
  const checkoutSessionId = crypto.randomUUID();
  const reservation = await createAtomicReservation({
    checkoutSessionId,
    variantId: variant.id,
    quantity: 1,
  });
  console.log(`[2] Created atomic reservation: ${reservation.id} (status: ${reservation.status})`);

  const checkoutResult = await createOrderFromCheckout({
    checkoutSessionId,
    customerEmail: testEmail,
    customerPhone: testPhone,
    shippingAddress: {
      fullName: "Guest Tester",
      phoneNumber: testPhone,
      addressLine1: "123 Test Boulevard",
      city: "Bengaluru",
      state: "Karnataka",
      postalCode: "560001",
      country: "IN",
    },
    checkoutIdempotencyKey: `idemp_${checkoutSessionId}`,
  });

  console.log(`[3] Created Order: ${checkoutResult.orderNumber} (Amount: ₹${checkoutResult.amount / 100})`);
  console.log(`    Razorpay Order ID: ${checkoutResult.razorpayOrderId}`);

  if (!checkoutResult.razorpayOrderId) {
    throw new Error("Razorpay Order ID was not generated!");
  }

  const orderRecord = await prisma.order.findUniqueOrThrow({
    where: { orderNumber: checkoutResult.orderNumber },
    include: { items: true, reservation: true },
  });

  if (orderRecord.userId !== null) {
    throw new Error("Guest order must have null userId!");
  }
  if (orderRecord.status !== OrderStatus.PAYMENT_PENDING) {
    throw new Error(`Order status expected PAYMENT_PENDING, got ${orderRecord.status}`);
  }

  // -------------------------------------------------------------
  // Test 2: Razorpay Webhook Raw HMAC-SHA256 & Durable Inbox
  // -------------------------------------------------------------
  const razorpayEventId = `evt_${crypto.randomBytes(8).toString("hex")}`;
  const mockPaymentId = `pay_${crypto.randomBytes(8).toString("hex")}`;
  const webhookSecret = "test_webhook_secret_key_123";

  const webhookPayloadObj = {
    entity: "event",
    account_id: "acc_test",
    event: "payment.captured",
    contains: ["payment"],
    payload: {
      payment: {
        entity: {
          id: mockPaymentId,
          entity: "payment",
          amount: checkoutResult.amount,
          currency: "INR",
          status: "captured",
          order_id: checkoutResult.razorpayOrderId,
          method: "upi",
        },
      },
    },
    created_at: Math.floor(Date.now() / 1000),
  };

  const rawBodyBuffer = Buffer.from(JSON.stringify(webhookPayloadObj), "utf8");
  const signature = crypto
    .createHmac("sha256", webhookSecret)
    .update(rawBodyBuffer)
    .digest("hex");

  const isSigValid = verifyRazorpayWebhookSignature(rawBodyBuffer, signature, webhookSecret);
  if (!isSigValid) {
    throw new Error("Webhook signature verification failed!");
  }
  console.log(`[4] Webhook HMAC-SHA256 signature verified successfully.`);

  // Persist into WebhookInbox
  const inbox = await prisma.webhookInbox.create({
    data: {
      provider: "RAZORPAY",
      eventId: razorpayEventId,
      eventType: "payment.captured",
      payload: webhookPayloadObj,
      status: WebhookProcessingStatus.PENDING,
    },
  });
  console.log(`[5] Persisted WebhookInbox record: ${inbox.id}`);

  // Test Webhook Deduplication constraint
  let duplicatePrevented = false;
  try {
    await prisma.webhookInbox.create({
      data: {
        provider: "RAZORPAY",
        eventId: razorpayEventId,
        eventType: "payment.captured",
        payload: webhookPayloadObj,
      },
    });
  } catch (err: any) {
    if (err.code === "P2002") {
      duplicatePrevented = true;
    }
  }
  if (!duplicatePrevented) {
    throw new Error("WebhookInbox failed to deduplicate duplicate event ID!");
  }
  console.log(`[6] Verified WebhookInbox unique constraint on eventId.`);

  // Process the inbox record
  await processWebhookInboxRecord(inbox.id);

  // Assert Order is now PAID and reservation COMMITTED
  const paidOrder = await prisma.order.findUniqueOrThrow({
    where: { id: orderRecord.id },
    include: {
      reservation: true,
      tagAllocations: true,
      subscriptionGrants: true,
      payments: true,
    },
  });

  if (paidOrder.status !== OrderStatus.PAID) {
    throw new Error(`Expected order status PAID, got ${paidOrder.status}`);
  }
  if (paidOrder.reservation.status !== ReservationStatus.COMMITTED) {
    throw new Error(`Expected reservation status COMMITTED, got ${paidOrder.reservation.status}`);
  }
  if (paidOrder.tagAllocations.length !== 4) {
    throw new Error(`Expected 4 tag allocations, got ${paidOrder.tagAllocations.length}`);
  }
  if (paidOrder.subscriptionGrants.length !== 1) {
    throw new Error(`Expected 1 subscription grant, got ${paidOrder.subscriptionGrants.length}`);
  }

  const grant = paidOrder.subscriptionGrants[0]!;
  if (grant.status !== GrantStatus.PENDING_CLAIM || grant.userId !== null) {
    throw new Error(`Guest grant must be PENDING_CLAIM with null userId! Got status=${grant.status}, userId=${grant.userId}`);
  }
  if (grant.plusDurationMonths !== 12) {
    throw new Error(`Expected 12 plusDurationMonths, got ${grant.plusDurationMonths}`);
  }

  // Check outbox job created
  const outbox = await prisma.outboxJob.findUnique({
    where: { dedupeKey: `order:${paidOrder.id}:fulfill` },
  });
  if (!outbox) {
    throw new Error("FULFILL_ORDER OutboxJob was not created in payment transaction!");
  }
  console.log(`[7] Order successfully reconciled to PAID. Tag allocations: ${paidOrder.tagAllocations.length}, Grant: PENDING_CLAIM, OutboxJob: ${outbox.type}`);

  // Test idempotency of payment reconciliation (duplicate capture event)
  await processWebhookInboxRecord(inbox.id);
  const tagAllocationsAfterDuplicate = await prisma.orderTagAllocation.count({
    where: { orderId: paidOrder.id },
  });
  if (tagAllocationsAfterDuplicate !== 4) {
    throw new Error("Payment reconciliation is not idempotent; duplicate tag allocations created!");
  }
  console.log(`[8] Verified payment reconciliation idempotency.`);

  // -------------------------------------------------------------
  // Test 3: Step 4 Guest Purchase Claiming with OTP
  // -------------------------------------------------------------
  const testUser = await prisma.user.create({
    data: {
      name: "Claiming User",
      mobileNumber: `91${Math.floor(10000000 + Math.random() * 90000000)}`,
    },
  });

  // Request claim OTP
  const otpResponse = await requestPurchaseClaimOtp(
    { orderNumber: paidOrder.orderNumber, contactType: "EMAIL" },
    testUser.id
  );
  console.log(`[9] Requested Claim OTP. Sent to: ${otpResponse.maskedContact}`);

  const testOtp = otpResponse.devOtp!;
  const claimResult = await verifyAndClaimPurchase(
    { orderNumber: paidOrder.orderNumber, otp: testOtp },
    testUser.id
  );
  console.log(`[10] Claimed purchase: ${claimResult.message}`);

  const claimedOrder = await prisma.order.findUniqueOrThrow({
    where: { id: paidOrder.id },
    include: { subscriptionGrants: true, purchaseClaim: true },
  });

  if (claimedOrder.userId !== testUser.id) {
    throw new Error(`Order userId was not updated to claiming user!`);
  }
  if (!claimedOrder.purchaseClaim) {
    throw new Error(`PurchaseClaim audit record was not created!`);
  }

  const updatedGrant = claimedOrder.subscriptionGrants[0]!;
  if (updatedGrant.userId !== testUser.id || updatedGrant.status !== GrantStatus.PENDING_PAIRING) {
    throw new Error(`Grant was not updated to PENDING_PAIRING for claiming user! Got ${updatedGrant.status}`);
  }
  console.log(`[11] Verified Order & Grant attached to user. Grant status: ${updatedGrant.status}`);

  // -------------------------------------------------------------
  // Test 4: Step 5 Tag Pairing & Subscription Activation
  // -------------------------------------------------------------
  // Create resource for testUser
  const resource = await prisma.resource.create({
    data: {
      userId: testUser.id,
      name: "My Honda Civic",
      type: ResourceType.VEHICLE,
    },
  });

  // Test Invariant: Unsold tag (IN_STOCK) CANNOT be paired
  const unsoldTag = await prisma.qrTag.findFirst({
    where: {
      origin: "PREPRINTED_INVENTORY",
      status: "UNASSIGNED",
      inventory: { state: QrTagStockState.IN_STOCK },
    },
  });

  if (unsoldTag) {
    let unsoldRejected = false;
    try {
      await pairQrTag({
        userId: testUser.id,
        resourceId: resource.id,
        tagNumber: unsoldTag.tagNumber,
      });
    } catch (err: any) {
      if (err.statusCode === 403) {
        unsoldRejected = true;
      }
    }
    if (!unsoldRejected) {
      throw new Error("Unsold tag in IN_STOCK was allowed to be paired! Invariant violated.");
    }
    console.log(`[12] Verified: Unsold tag in IN_STOCK correctly rejected with 403 Forbidden.`);
  }

  // Now pair one of the 4 tags allocated to the order
  const allocatedTagId = paidOrder.tagAllocations[0]!.qrTagId;
  const allocatedTag = await prisma.qrTag.findUniqueOrThrow({
    where: { id: allocatedTagId },
  });

  const pairResult = await pairQrTag({
    userId: testUser.id,
    resourceId: resource.id,
    tagNumber: allocatedTag.tagNumber,
  });

  console.log(`[13] Paired Tag ${allocatedTag.tagNumber}: ${pairResult.message}`);
  if (!pairResult.activatedPlus) {
    throw new Error("Pairing should have triggered PLUS subscription activation!");
  }

  // Verify SubscriptionGrant is now ACTIVATED
  const activatedGrant = await prisma.subscriptionGrant.findUniqueOrThrow({
    where: { id: updatedGrant.id },
  });
  if (activatedGrant.status !== GrantStatus.ACTIVATED || !activatedGrant.activatedAt) {
    throw new Error(`SubscriptionGrant status should be ACTIVATED, got ${activatedGrant.status}`);
  }

  // Verify User's subscription in DB is PLUS with 12 months
  const userSub = await prisma.subscription.findUniqueOrThrow({
    where: { userId: testUser.id },
  });
  if (userSub.tier !== SubscriptionTier.PLUS) {
    throw new Error(`User subscription tier expected PLUS, got ${userSub.tier}`);
  }
  console.log(`[14] Verified: User subscription upgraded to ${userSub.tier}, expiresAt: ${userSub.expiresAt}`);

  // Test 5: Gifted Tag Scenario
  // Second tag from the order is gifted to a friend
  const friendUser = await prisma.user.create({
    data: {
      name: "Friend Recipient",
      mobileNumber: `92${Math.floor(10000000 + Math.random() * 90000000)}`,
    },
  });
  const friendResource = await prisma.resource.create({
    data: {
      userId: friendUser.id,
      name: "Friend Scooter",
      type: ResourceType.VEHICLE,
    },
  });

  const giftedTagId = paidOrder.tagAllocations[1]!.qrTagId;
  const giftedTag = await prisma.qrTag.findUniqueOrThrow({ where: { id: giftedTagId } });

  const friendPairResult = await pairQrTag({
    userId: friendUser.id,
    resourceId: friendResource.id,
    tagNumber: giftedTag.tagNumber,
  });

  console.log(`[15] Friend paired gifted tag: ${friendPairResult.message}`);
  if (friendPairResult.activatedPlus) {
    throw new Error("Gifted tag should NOT give friend PLUS without their own grant!");
  }

  const friendSub = await prisma.subscription.findUnique({
    where: { userId: friendUser.id },
  });
  if (friendSub && friendSub.tier !== SubscriptionTier.BASIC) {
    throw new Error(`Friend should remain on BASIC plan! Got ${friendSub.tier}`);
  }
  console.log(`[16] Verified: Gifted tag successfully pairs under BASIC without transfer of purchaser's PLUS.`);

  // Test 6: Public Order Status Endpoint
  const statusCheck = await getOrderStatus(paidOrder.orderNumber);
  console.log(`[17] Public Order Status:`, {
    orderNumber: statusCheck.orderNumber,
    status: statusCheck.status,
    isClaimed: statusCheck.isClaimed,
    customerEmail: statusCheck.customerEmail,
  });

  if (statusCheck.status !== "PAID" || !statusCheck.isClaimed) {
    throw new Error("Order status API returned incorrect details!");
  }

  console.log("\n=======================================================");
  console.log("✅ ALL STEPS 3-5 ACCEPTANCE CRITERIA VERIFIED SUCCESSFULLY!");
  console.log("=======================================================\n");
}

runSteps3To5Test()
  .catch((err) => {
    console.error("❌ TEST FAILED:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
