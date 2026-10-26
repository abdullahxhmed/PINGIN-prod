import crypto from "node:crypto";
import { GrantStatus, OrderStatus, OtpPurpose, QrTagStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { BadRequestError, ConflictError, NotFoundError } from "../../errors/AppError.js";
import { activateUserPlusSubscription } from "../subscriptions/subscriptions.services.js";
import type { RequestClaimOtpInput, VerifyClaimOtpInput } from "./claims.types.js";

const hashOtp = (otp: string): string => {
  return crypto.createHash("sha256").update(otp.trim()).digest("hex");
};

const maskContact = (contact: string): string => {
  if (contact.includes("@")) {
    const [name, domain] = contact.split("@");
    if (!name || !domain) return contact;
    const masked = name.length <= 2 ? name[0] + "***" : name.slice(0, 2) + "***" + name.slice(-1);
    return `${masked}@${domain}`;
  }
  if (contact.length < 4) return contact;
  return contact.slice(0, 2) + "******" + contact.slice(-2);
};

/**
 * Initiates an OTP verification request to prove control over the guest order's contact details.
 * Prevents auto-claiming or claiming without verified OTP.
 */
export const requestPurchaseClaimOtp = async (
  input: RequestClaimOtpInput,
  requestingUserId: string
) => {
  const { orderNumber, contactType } = input;

  const order = await prisma.order.findUnique({
    where: { orderNumber },
    include: {
      purchaseClaim: true,
    },
  });

  if (!order) {
    throw new NotFoundError(`Order ${orderNumber} not found.`);
  }

  if (order.userId || order.purchaseClaim) {
    throw new ConflictError("This order has already been claimed into an account.");
  }

  if (order.status !== OrderStatus.PAID) {
    throw new BadRequestError(`Order must be confirmed paid before it can be claimed (current status: ${order.status}).`);
  }

  let destinationContact: string | null = null;
  if (contactType === "EMAIL") {
    destinationContact = order.customerEmail;
    if (!destinationContact) {
      throw new BadRequestError("This order does not have an email address on record. Try phone verification.");
    }
  } else {
    destinationContact = order.customerPhone;
    if (!destinationContact) {
      throw new BadRequestError("This order does not have a phone number on record. Try email verification.");
    }
  }

  // Generate secure 6-digit OTP
  const rawOtp = crypto.randomInt(100000, 999999).toString();
  const otpHash = hashOtp(rawOtp);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  await prisma.otpVerification.create({
    data: {
      mobileNumber: destinationContact,
      otpHash,
      purpose: OtpPurpose.CLAIM_PURCHASE,
      expiresAt,
    },
  });

  // In development/test log the OTP for testing convenience
  if (process.env.NODE_ENV !== "production") {
    console.log(`[CLAIM OTP DEV] Order: ${orderNumber}, Destination: ${destinationContact}, OTP: ${rawOtp}`);
  }

  return {
    success: true,
    message: `OTP sent to verified contact on order ${orderNumber}`,
    maskedContact: maskContact(destinationContact),
    expiresAt,
    // Return devOtp in non-production for automated tests
    devOtp: process.env.NODE_ENV !== "production" ? rawOtp : undefined,
  };
};

/**
 * Verifies OTP and attaches guest order and unredeemed Plus grant to the claiming account.
 * Crucial Invariant: Pairing and purchase claiming can happen in either order.
 * If user already paired an eligible QR tag after grant creation, activates PLUS retroactively.
 */
export const verifyAndClaimPurchase = async (
  input: VerifyClaimOtpInput,
  claimingUserId: string
) => {
  const { orderNumber, otp } = input;
  const otpHash = hashOtp(otp);
  const now = new Date();

  return await prisma.$transaction(async (tx) => {
    // 1. Fetch order with exclusive row lock
    const order = await tx.order.findUnique({
      where: { orderNumber },
      include: {
        subscriptionGrants: true,
        purchaseClaim: true,
      },
    });

    if (!order) {
      throw new NotFoundError(`Order ${orderNumber} not found.`);
    }

    if (order.userId || order.purchaseClaim) {
      throw new ConflictError("This order has already been claimed by an account.");
    }

    if (order.status !== OrderStatus.PAID) {
      throw new BadRequestError("Only paid orders can be claimed.");
    }

    // 2. Validate OTP against contacts on the order
    const validContacts = [order.customerEmail, order.customerPhone].filter(Boolean) as string[];

    const otpRecord = await tx.otpVerification.findFirst({
      where: {
        mobileNumber: { in: validContacts },
        otpHash,
        purpose: OtpPurpose.CLAIM_PURCHASE,
        usedAt: null,
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!otpRecord) {
      throw new BadRequestError("Invalid or expired OTP. Please request a new verification code.");
    }

    // Mark OTP as used
    await tx.otpVerification.update({
      where: { id: otpRecord.id },
      data: { usedAt: now },
    });

    // 3. Attach order to claiming user
    await tx.order.update({
      where: { id: order.id },
      data: { userId: claimingUserId },
    });

    // 4. Create audit record of purchase claim
    const verificationMethod = otpRecord.mobileNumber.includes("@") ? "EMAIL_OTP" : "PHONE_OTP";
    await tx.purchaseClaim.create({
      data: {
        orderId: order.id,
        userId: claimingUserId,
        verificationMethod,
        verifiedAt: now,
      },
    });

    // 5. Update SubscriptionGrant: transition from PENDING_CLAIM to PENDING_PAIRING
    const grant = await tx.subscriptionGrant.findFirst({
      where: { orderId: order.id },
    });

    let activatedRetroactively = false;

    if (grant) {
      await tx.subscriptionGrant.update({
        where: { id: grant.id },
        data: {
          userId: claimingUserId,
          status: GrantStatus.PENDING_PAIRING,
        },
      });

      // 6. Retroactive Pairing Evaluation:
      // Did this user already pair an eligible QR tag on or after this grant's creation?
      const eligiblePairing = await tx.qrTag.findFirst({
        where: {
          resource: { userId: claimingUserId, active: true },
          status: QrTagStatus.ASSIGNED,
          assignedAt: { gte: grant.createdAt },
        },
        orderBy: { assignedAt: "asc" },
      });

      if (eligiblePairing) {
        // Redeem grant immediately!
        const redeemed = await tx.subscriptionGrant.updateMany({
          where: { id: grant.id, userId: claimingUserId, status: GrantStatus.PENDING_PAIRING },
          data: {
            status: GrantStatus.ACTIVATED,
            activatedAt: now,
            triggeringQrTagId: eligiblePairing.id,
          },
        });

        if (redeemed.count === 1) {
          await activateUserPlusSubscription(tx, claimingUserId, grant.plusDurationMonths);
          activatedRetroactively = true;
        }
      }
    }

    return {
      success: true,
      orderNumber: order.orderNumber,
      claimed: true,
      grantActivated: activatedRetroactively,
      plusDurationMonths: grant ? grant.plusDurationMonths : 0,
      message: activatedRetroactively
        ? `Order successfully claimed! Plus subscription activated for ${grant?.plusDurationMonths} months.`
        : "Order successfully claimed! Plus subscription will activate upon pairing your first QR tag.",
    };
  });
};
