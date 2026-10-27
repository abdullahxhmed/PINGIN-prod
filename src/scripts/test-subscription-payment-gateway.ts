import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma.js";
import {
  createPackPurchase,
  getUserSubscription,
  reconcileCapturedSubscriptionPayment,
  reconcileFailedSubscriptionPayment,
  verifySubscriptionPayment,
} from "../modules/subscriptions/subscriptions.services.js";
import {
  PurchasePackType,
  PurchaseStatus,
  SubscriptionTier,
} from "@prisma/client";

async function runPaymentGatewayTests() {
  console.log("=== Starting In-App Subscription Payment Gateway E2E Verification ===");

  const randomSuffix = Math.floor(100000 + Math.random() * 900000);
  const testMobile = `+919888${randomSuffix}`;
  const testUser = await prisma.user.create({
    data: {
      name: `Payment Test User ${randomSuffix}`,
      mobileNumber: testMobile,
    },
  });
  console.log(`✓ 1. Created authenticated test user: ${testUser.id} (${testUser.mobileNumber})`);

  try {
    // 2. Initial state verification
    const initialSub = await getUserSubscription(testUser.id);
    console.log(`✓ 2. User defaults to ${initialSub.subscription.tier} plan (max tags: ${initialSub.subscription.maxActiveTags})`);
    if (initialSub.subscription.tier !== SubscriptionTier.BASIC) {
      throw new Error("Default subscription must be BASIC");
    }

    // 3. Initiate payment order (calls Razorpay Orders API under the hood)
    console.log("\n--- Testing Order Creation (Razorpay Orders API) ---");
    const purchaseResult = await createPackPurchase(
      testUser.id,
      PurchasePackType.PLUS_RENEWAL,
      "RAZORPAY"
    );

    console.log(`✓ 3. Purchase record created: ${purchaseResult.purchaseId}`);
    console.log(`    Razorpay Order ID: ${purchaseResult.razorpayOrderId}`);
    console.log(`    Amount: ₹${purchaseResult.amount / 100} (${purchaseResult.amount} paise)`);
    console.log(`    Prefill: Name='${purchaseResult.prefill.name}', Contact='${purchaseResult.prefill.contact}'`);
    console.log(`    Key ID: ${purchaseResult.keyId}`);

    if (!purchaseResult.razorpayOrderId) {
      throw new Error("Expected a valid Razorpay Order ID to be generated!");
    }
    if (purchaseResult.amount !== 9900) {
      throw new Error(`Expected amount 9900 paise, got ${purchaseResult.amount}`);
    }

    // 4. Test Invalid Payment Signature Rejection
    console.log("\n--- Testing Cryptographic Signature Security ---");
    const fakePaymentId = `pay_fake_${randomSuffix}`;
    const invalidSignature = "invalid_signature_hex_digest_1234567890abcdef";

    try {
      await verifySubscriptionPayment(testUser.id, {
        razorpayOrderId: purchaseResult.razorpayOrderId,
        razorpayPaymentId: fakePaymentId,
        razorpaySignature: invalidSignature,
      });
      throw new Error("Security failure: verification should have rejected invalid signature!");
    } catch (err: any) {
      if (err.statusCode === 401 || err.message.includes("Invalid payment signature")) {
        console.log("✓ 4. Tampered / invalid payment signature rejected successfully (401 Unauthorized)");
      } else {
        throw err;
      }
    }

    // 5. Test Valid Cryptographic Signature Verification
    console.log("\n--- Testing Valid Payment Signature Verification ---");
    const secret = process.env.RAZORPAY_KEY_SECRET;
    if (!secret) {
      throw new Error("RAZORPAY_KEY_SECRET is required in .env for live test");
    }

    const validPaymentId = `pay_test_${crypto.randomBytes(7).toString("hex")}`;
    const validSignature = crypto
      .createHmac("sha256", secret)
      .update(`${purchaseResult.razorpayOrderId}|${validPaymentId}`)
      .digest("hex");

    const verificationResult = await verifySubscriptionPayment(testUser.id, {
      razorpayOrderId: purchaseResult.razorpayOrderId,
      razorpayPaymentId: validPaymentId,
      razorpaySignature: validSignature,
    });

    console.log(`✓ 5. Payment verified successfully: ${verificationResult.message}`);
    console.log(`    Upgraded Tier: ${verificationResult.subscription.tier}`);
    console.log(`    Max Active Tags: ${verificationResult.subscription.maxActiveTags}`);
    console.log(`    WhatsApp Alerts: ${verificationResult.subscription.hasWhatsappAlerts}`);
    console.log(`    Scan Analytics: ${verificationResult.subscription.hasAnalytics}`);
    console.log(`    Expires At: ${verificationResult.subscription.expiresAt?.toISOString()}`);

    if (verificationResult.subscription.tier !== SubscriptionTier.PLUS) {
      throw new Error("Subscription tier should be upgraded to PLUS!");
    }
    if (verificationResult.subscription.maxActiveTags !== 8) {
      throw new Error("PLUS plan must allow 8 active tags!");
    }

    // 6. Test Idempotency
    console.log("\n--- Testing Idempotency ---");
    const reVerification = await verifySubscriptionPayment(testUser.id, {
      razorpayOrderId: purchaseResult.razorpayOrderId,
      razorpayPaymentId: validPaymentId,
      razorpaySignature: validSignature,
    });
    console.log(`✓ 6. Idempotent re-verification response: ${reVerification.message}`);
    if (reVerification.subscription.tier !== SubscriptionTier.PLUS) {
      throw new Error("Re-verification should return active PLUS tier!");
    }

    // 7. Test Webhook Reconciliation Flow
    console.log("\n--- Testing Webhook Reconciliation Flow ---");
    const secondPurchase = await createPackPurchase(
      testUser.id,
      PurchasePackType.PACK_179,
      "RAZORPAY"
    );
    console.log(`✓ Created 2nd purchase for webhook test: ${secondPurchase.purchaseId} (Order: ${secondPurchase.razorpayOrderId})`);

    const webhookPaymentId = `pay_hook_${crypto.randomBytes(7).toString("hex")}`;
    await reconcileCapturedSubscriptionPayment({
      providerOrderId: secondPurchase.razorpayOrderId!,
      providerPaymentId: webhookPaymentId,
      amount: secondPurchase.amount,
      currency: secondPurchase.currency,
      rawPayload: { event: "payment.captured", source: "E2E_TEST" },
    });

    const postWebhookSub = await getUserSubscription(testUser.id);
    console.log(`✓ 7. Webhook reconciliation successfully completed!`);
    console.log(`    Accumulated Plus expiration: ${postWebhookSub.subscription.expiresAt?.toISOString()}`);

    // Verify the second purchase was marked COMPLETED
    const completedPurchase = await prisma.subscriptionPurchase.findUnique({
      where: { id: secondPurchase.purchaseId },
    });
    if (completedPurchase?.status !== PurchaseStatus.COMPLETED) {
      throw new Error("Webhook reconciliation did not transition purchase to COMPLETED");
    }

    console.log("\n=== All In-App Subscription Payment Gateway Tests Passed Successfully! ===");
  } finally {
    // Cleanup
    await prisma.subscriptionPurchase.deleteMany({
      where: { userId: testUser.id },
    });
    await prisma.subscription.deleteMany({
      where: { userId: testUser.id },
    });
    await prisma.user.delete({
      where: { id: testUser.id },
    });
    console.log(`✓ Cleaned up test user: ${testUser.id}`);
  }
}

runPaymentGatewayTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Test failed with error:", err);
    process.exit(1);
  });
