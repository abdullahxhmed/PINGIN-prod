import crypto from "node:crypto";
import { UnauthorizedError } from "../../errors/AppError.js";

/**
 * Validates Razorpay Webhook signature using HMAC-SHA256 with the exact raw body bytes.
 * Reference: https://razorpay.com/docs/webhooks/validate-test/
 */
export const verifyRazorpayWebhookSignature = (
  rawBody: Buffer | undefined,
  signature: string | undefined,
  secretOverride?: string
): boolean => {
  if (!rawBody || !signature) {
    return false;
  }

  const primarySecret = secretOverride || process.env.RAZORPAY_WEBHOOK_SECRET;
  const secondarySecret = process.env.RAZORPAY_WEBHOOK_SECRET_OLD; // Support secret rotation

  const secretsToTry = [primarySecret, secondarySecret].filter(Boolean) as string[];

  if (secretsToTry.length === 0) {
    if (process.env.NODE_ENV === "test" || process.env.RAZORPAY_MOCK === "true") {
      // Allow testing without live secret if specifically designated test mode
      return signature === "test_mock_signature" || signature.length > 0;
    }
    return false;
  }

  for (const secret of secretsToTry) {
    try {
      const expectedSignature = crypto
        .createHmac("sha256", secret)
        .update(rawBody)
        .digest("hex");

      const expectedBuffer = Buffer.from(expectedSignature, "utf8");
      const signatureBuffer = Buffer.from(signature.trim(), "utf8");

      if (
        expectedBuffer.length === signatureBuffer.length &&
        crypto.timingSafeEqual(expectedBuffer, signatureBuffer)
      ) {
        return true;
      }
    } catch {
      continue;
    }
  }

  return false;
};
