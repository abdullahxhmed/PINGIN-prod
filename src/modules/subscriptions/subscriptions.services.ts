import crypto from "node:crypto";
import {
  Prisma,
  PurchasePackType,
  PurchaseStatus,
  QrTagStatus,
  SubscriptionTier,
} from "@prisma/client";
import { BadRequestError, NotFoundError, UnauthorizedError } from "../../errors/AppError.js";
import { prisma } from "../../lib/prisma.js";
import { razorpayClient } from "../../integrations/razorpay/razorpay.client.js";
import {
  PACK_CATALOG,
  PLAN_CONFIGS,
  type VerifySubscriptionPaymentInput,
} from "./subscriptions.types.js";
import { decryptPhoneNumber } from "../../utils/data-protection.js";

export interface SubscriptionCallingCheck {
  canMakeCalls: boolean;
  status: "ACTIVE" | "GRACE_PERIOD" | "EXPIRED" | "INACTIVE";
  tier: SubscriptionTier;
  isGracePeriod: boolean;
  isExpired: boolean;
  whatsappOnly: boolean;
  isFupFlagged: boolean;
  monthlyUsedSeconds: number;
  monthlyFupLimitSeconds: number;
  hardCallLimitSeconds: number;
  message?: string;
}

/**
 * Checks calling entitlement, grace period, and 5-min monthly Fair Use Policy.
 * - During 14-day grace period: Calls continue normally.
 * - After 14-day grace period: All phone calls are stopped; WhatsApp alerts only.
 * - Hard call cutoff: 590s (strictly below 10 minutes).
 */
export const checkUserSubscriptionCallingStatus = async (
  userId: string
): Promise<SubscriptionCallingCheck> => {
  const subscription = await prisma.subscription.findUnique({
    where: { userId },
  });

  const now = new Date();
  const plusConfig = PLAN_CONFIGS[SubscriptionTier.PLUS];
  const hardCallLimitSeconds = plusConfig.hardCallLimitSeconds; // 590s (< 10 min)
  const monthlyFupLimitSeconds = plusConfig.fupMinutesPerMonth * 60; // 300s (5 min)

  // 1. Calculate current month telephony usage
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthlyUsage = await prisma.communicationCall.aggregate({
    where: {
      session: {
        resource: { userId },
      },
      status: "COMPLETED",
      createdAt: { gte: startOfMonth },
    },
    _sum: { durationSec: true },
  });
  const monthlyUsedSeconds = monthlyUsage._sum.durationSec ?? 0;
  const isFupFlagged = monthlyUsedSeconds > monthlyFupLimitSeconds;

  // Sync isFupFlagged in DB if changed
  if (subscription && subscription.isFupFlagged !== isFupFlagged) {
    await prisma.subscription
      .update({
        where: { userId },
        data: { isFupFlagged },
      })
      .catch((err) => console.warn("Failed to update isFupFlagged:", err));
  }

  // 2. Determine expiration and grace period
  if (!subscription) {
    return {
      canMakeCalls: false,
      status: "INACTIVE",
      tier: SubscriptionTier.BASIC,
      isGracePeriod: false,
      isExpired: true,
      whatsappOnly: true,
      isFupFlagged,
      monthlyUsedSeconds,
      monthlyFupLimitSeconds,
      hardCallLimitSeconds,
      message: "No active subscription found. Calls are disabled; WhatsApp alerts only.",
    };
  }

  const gracePeriodDays = subscription.gracePeriodDays ?? 14;
  const gracePeriodMs = gracePeriodDays * 24 * 60 * 60 * 1000;

  if (subscription.tier === SubscriptionTier.PLUS) {
    if (subscription.expiresAt) {
      if (now <= subscription.expiresAt) {
        return {
          canMakeCalls: true,
          status: "ACTIVE",
          tier: subscription.tier,
          isGracePeriod: false,
          isExpired: false,
          whatsappOnly: false,
          isFupFlagged,
          monthlyUsedSeconds,
          monthlyFupLimitSeconds,
          hardCallLimitSeconds,
        };
      }

      // Past expiresAt: Check 14-day grace period
      const timeSinceExpiry = now.getTime() - subscription.expiresAt.getTime();
      if (timeSinceExpiry <= gracePeriodMs) {
        return {
          canMakeCalls: true,
          status: "GRACE_PERIOD",
          tier: subscription.tier,
          isGracePeriod: true,
          isExpired: false,
          whatsappOnly: false,
          isFupFlagged,
          monthlyUsedSeconds,
          monthlyFupLimitSeconds,
          hardCallLimitSeconds,
          message: `Subscription is in ${gracePeriodDays}-day grace period. Please renew to avoid call suspension.`,
        };
      }

      // Past 14-day grace period: Calls STOPPED! WhatsApp only.
      return {
        canMakeCalls: false,
        status: "EXPIRED",
        tier: subscription.tier,
        isGracePeriod: false,
        isExpired: true,
        whatsappOnly: true,
        isFupFlagged,
        monthlyUsedSeconds,
        monthlyFupLimitSeconds,
        hardCallLimitSeconds,
        message: "14-day grace period expired. All phone calls are stopped. WhatsApp alerts only.",
      };
    }

    // Plus without expiresAt (unusual): treat as active
    return {
      canMakeCalls: true,
      status: "ACTIVE",
      tier: subscription.tier,
      isGracePeriod: false,
      isExpired: false,
      whatsappOnly: false,
      isFupFlagged,
      monthlyUsedSeconds,
      monthlyFupLimitSeconds,
      hardCallLimitSeconds,
    };
  }

  // Tier is BASIC (expired / unpaid fallback)
  return {
    canMakeCalls: false,
    status: "EXPIRED",
    tier: subscription.tier,
    isGracePeriod: false,
    isExpired: true,
    whatsappOnly: true,
    isFupFlagged,
    monthlyUsedSeconds,
    monthlyFupLimitSeconds,
    hardCallLimitSeconds,
    message: "Service expired. Phone calls stopped. WhatsApp notifications only.",
  };
};

/**
 * Returns user's active subscription, enforcing 14-day grace period and WhatsApp fallback.
 */
export const getUserSubscription = async (userId: string) => {
  let subscription = await prisma.subscription.findUnique({
    where: { userId },
    include: { plan: true },
  });

  const now = new Date();

  // 1. Initialize default BASIC subscription if none exists
  if (!subscription) {
    const basicConfig = PLAN_CONFIGS[SubscriptionTier.BASIC];
    subscription = await prisma.subscription.create({
      data: {
        userId,
        tier: SubscriptionTier.BASIC,
        maxActiveTags: basicConfig.maxActiveTags,
        hasWhatsappAlerts: basicConfig.hasWhatsappAlerts,
        hasAnalytics: basicConfig.hasAnalytics,
        startsAt: now,
        expiresAt: null,
      },
      include: { plan: true },
    });
  }

  if (!subscription) {
    throw new NotFoundError("Subscription record could not be resolved.");
  }

  // 2. Fetch calling and FUP status
  const callingStatus = await checkUserSubscriptionCallingStatus(userId);

  // 3. Fetch user's currently paired QR tags (both ASSIGNED and SUSPENDED)
  const pairedTags = await prisma.qrTag.findMany({
    where: {
      resource: {
        userId,
        active: true,
      },
      status: {
        in: [QrTagStatus.ASSIGNED, QrTagStatus.SUSPENDED],
      },
    },
    include: {
      resource: {
        select: {
          id: true,
          name: true,
          type: true,
          vehicleDetail: {
            select: {
              registrationNum: true,
              vehicleColour: true,
            },
          },
        },
      },
    },
    orderBy: { assignedAt: "asc" },
  });

  const assignedTags = pairedTags.filter((t) => t.status === QrTagStatus.ASSIGNED);
  const suspendedTags = pairedTags.filter((t) => t.status === QrTagStatus.SUSPENDED);

  // Calculate days remaining if expiresAt is set
  let daysRemaining: number | null = null;
  if (subscription.expiresAt && subscription.expiresAt > now) {
    const diffMs = subscription.expiresAt.getTime() - now.getTime();
    daysRemaining = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
  }

  return {
    subscription: {
      id: subscription.id,
      tier: subscription.tier,
      planId: subscription.planId,
      plan: subscription.plan
        ? {
            id: subscription.plan.id,
            code: subscription.plan.code,
            name: subscription.plan.name,
            tagQuota: subscription.plan.tagQuota,
            durationDays: subscription.plan.durationDays,
          }
        : null,
      status: callingStatus.status,
      maxActiveTags: subscription.maxActiveTags,
      hasLifetimeCalling: false,
      hasWhatsappAlerts: subscription.hasWhatsappAlerts,
      hasAnalytics: subscription.hasAnalytics,
      isFupFlagged: callingStatus.isFupFlagged,
      canMakeCalls: callingStatus.canMakeCalls,
      whatsappOnly: callingStatus.whatsappOnly,
      startsAt: subscription.startsAt,
      expiresAt: subscription.expiresAt,
      gracePeriodDays: subscription.gracePeriodDays ?? 14,
      daysRemaining,
      isExpired: callingStatus.isExpired,
      isGracePeriod: callingStatus.isGracePeriod,
      fup: {
        monthlyUsedSeconds: callingStatus.monthlyUsedSeconds,
        monthlyFupLimitSeconds: callingStatus.monthlyFupLimitSeconds,
        monthlyUsedMinutes: Math.round((callingStatus.monthlyUsedSeconds / 60) * 10) / 10,
        isFlagged: callingStatus.isFupFlagged,
        hardCallLimitSeconds: callingStatus.hardCallLimitSeconds,
      },
      resumptionPrompt: callingStatus.isExpired
        ? "Calls stopped. Renew your Plus Plan for ₹149 to resume call masking."
        : null,
    },
    tags: {
      activeCount: assignedTags.length,
      suspendedCount: suspendedTags.length,
      totalCount: pairedTags.length,
      maxLimit: subscription.maxActiveTags,
      needsTagSelection: assignedTags.length > subscription.maxActiveTags,
      assigned: assignedTags.map((t) => ({
        id: t.id,
        tagNumber: t.tagNumber,
        status: t.status,
        assignedAt: t.assignedAt,
        resource: t.resource,
      })),
      suspended: suspendedTags.map((t) => ({
        id: t.id,
        tagNumber: t.tagNumber,
        status: t.status,
        assignedAt: t.assignedAt,
        resource: t.resource,
      })),
    },
    catalog: [PACK_CATALOG[PurchasePackType.PLUS_149]],
  };
};

/**
 * Customer telephony usage endpoint.
 * Returns current period usage, call totals, actual & billed seconds, and allowance structure.
 * Internal provider costs and sensitive caller details are never exposed to customers.
 */
export const getUserTelephonyUsage = async (userId: string) => {
  const now = new Date();
  const startsAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
  const endsAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999));

  // Find all calls in current period linked directly to userId or via user's resources
  const calls = await prisma.communicationCall.findMany({
    where: {
      OR: [
        { userId },
        { session: { resource: { userId } } },
      ],
      createdAt: {
        gte: startsAt,
        lte: endsAt,
      },
    },
    select: {
      id: true,
      status: true,
      actualDurationSeconds: true,
      billedDurationSeconds: true,
      durationSec: true,
      connectedAt: true,
    },
  });

  const totalCalls = calls.length;
  let connectedCalls = 0;
  let actualSeconds = 0;
  let billedSeconds = 0;

  for (const call of calls) {
    const isConnected =
      call.status === "CONNECTED" ||
      call.status === "COMPLETED" ||
      call.connectedAt != null;

    if (isConnected) {
      connectedCalls++;
    }

    const actual =
      call.actualDurationSeconds > 0
        ? call.actualDurationSeconds
        : (call.durationSec ?? 0);
    actualSeconds += actual;

    const billed =
      call.billedDurationSeconds > 0
        ? call.billedDurationSeconds
        : isConnected
        ? Math.ceil(actual / 60) * 60
        : 0;
    billedSeconds += billed;
  }

  return {
    period: {
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
    },
    usage: {
      totalCalls,
      connectedCalls,
      actualSeconds,
      billedSeconds,
    },
    allowance: {
      limitSeconds: null,
      usedSeconds: billedSeconds,
      remainingSeconds: null,
    },
  };
};

/**
 * Allows a demoted user to pick which 2 tags remain active, setting all remaining tags to SUSPENDED.
 */
export const selectActiveTags = async (userId: string, activeTagIds: string[]) => {
  const { subscription } = await getUserSubscription(userId);

  if (activeTagIds.length > subscription.maxActiveTags) {
    throw new BadRequestError(
      `Your current ${subscription.tier} plan allows a maximum of ${subscription.maxActiveTags} active tags. You selected ${activeTagIds.length}.`
    );
  }

  const userTags = await prisma.qrTag.findMany({
    where: {
      resource: {
        userId,
        active: true,
      },
      status: {
        in: [QrTagStatus.ASSIGNED, QrTagStatus.SUSPENDED],
      },
    },
  });

  const userTagIdSet = new Set(userTags.map((t) => t.id));
  for (const id of activeTagIds) {
    if (!userTagIdSet.has(id)) {
      throw new BadRequestError(`Tag ID ${id} is not paired to your account.`);
    }
  }

  const selectedSet = new Set(activeTagIds);
  const now = new Date();

  // Atomically update tags: selected -> ASSIGNED, unselected -> SUSPENDED
  await prisma.$transaction(async (tx) => {
    for (const tag of userTags) {
      const shouldBeActive = selectedSet.has(tag.id);
      const newStatus = shouldBeActive ? QrTagStatus.ASSIGNED : QrTagStatus.SUSPENDED;

      if (tag.status !== newStatus) {
        await tx.qrTag.update({
          where: { id: tag.id },
          data: { status: newStatus },
        });

        if (newStatus === QrTagStatus.SUSPENDED && tag.resourceId) {
          await tx.qrAssignment.updateMany({
            where: {
              qrTagId: tag.id,
              resourceId: tag.resourceId,
              unassignedAt: null,
            },
            data: { unassignedAt: now },
          });
        }
      }
    }
  });

  return getUserSubscription(userId);
};

/**
 * Initiates a purchase for a subscription pack using server-side configuration.
 * Generates a Razorpay Order and returns checkout parameters for in-app payment.
 */
export const createPackPurchase = async (
  userId: string,
  packType: PurchasePackType,
  paymentProvider = "RAZORPAY",
  metadata?: Prisma.InputJsonValue
) => {
  const packDef = PACK_CATALOG[packType];
  if (!packDef) {
    throw new BadRequestError(`Invalid pack type: ${packType}`);
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, mobileNumber: true },
  });

  if (!user) {
    throw new NotFoundError("User not found");
  }

  // 1. Create a pending purchase record
  const purchase = await prisma.subscriptionPurchase.create({
    data: {
      userId,
      packType,
      amountPaise: packDef.amountPaise,
      currency: packDef.currency,
      tagsIncluded: packDef.tagsIncluded,
      plusDurationMonths: packDef.plusDurationMonths,
      status: PurchaseStatus.PENDING,
      paymentProvider,
      metadata: metadata || Prisma.JsonNull,
    },
  });

  let razorpayOrder = null;
  if (paymentProvider === "RAZORPAY") {
    // Generate receipt identifier (max 40 chars for Razorpay API)
    const receipt = `sub_${purchase.id.replace(/-/g, "").slice(0, 32)}`;
    try {
      razorpayOrder = await razorpayClient.createOrder({
        amount: packDef.amountPaise,
        currency: packDef.currency,
        receipt,
        notes: {
          purchaseId: purchase.id,
          userId,
          packType,
          purpose: "IN_APP_SUBSCRIPTION_PURCHASE",
        },
      });

      // Update purchase record with providerOrderId
      await prisma.subscriptionPurchase.update({
        where: { id: purchase.id },
        data: {
          providerOrderId: razorpayOrder.id,
        },
      });
    } catch (err: any) {
      throw new BadRequestError(`Failed to initiate payment gateway: ${err.message}`);
    }
  }

  return {
    purchase,
    pack: packDef,
    purchaseId: purchase.id,
    packType: packDef.packType,
    amount: packDef.amountPaise,
    currency: packDef.currency,
    razorpayOrderId: razorpayOrder ? razorpayOrder.id : null,
    keyId: razorpayOrder ? razorpayClient.getKeyId() : null,
    prefill: {
      name: user.name,
      contact: decryptPhoneNumber(user.mobileNumber),
    },
  };
};

/**
 * Direct cryptographic verification of Razorpay payment signature for subscription purchases.
 * Transitions SubscriptionPurchase to COMPLETED and activates Plus plan immediately.
 */
export const verifySubscriptionPayment = async (
  userId: string,
  input: VerifySubscriptionPaymentInput
) => {
  const { razorpayOrderId, razorpayPaymentId, razorpaySignature, purchaseId } = input;

  // 1. Resolve local purchase record
  const purchase = await prisma.subscriptionPurchase.findFirst({
    where: purchaseId
      ? { id: purchaseId, userId }
      : { providerOrderId: razorpayOrderId, userId },
  });

  if (!purchase) {
    throw new NotFoundError(
      `No subscription purchase record found matching Order ID '${razorpayOrderId}'`
    );
  }

  // 2. Cryptographic signature verification using RAZORPAY_KEY_SECRET
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret) {
    if (
      process.env.NODE_ENV === "test" ||
      process.env.RAZORPAY_MOCK === "true" ||
      razorpayClient.isMockMode()
    ) {
      if (
        razorpaySignature !== "test_mock_signature" &&
        razorpaySignature.length === 0
      ) {
        throw new UnauthorizedError("Invalid payment signature");
      }
    } else {
      throw new Error("Razorpay secret not configured on server (RAZORPAY_KEY_SECRET)");
    }
  } else {
    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(`${razorpayOrderId}|${razorpayPaymentId}`)
      .digest("hex");

    const expectedBuffer = Buffer.from(expectedSignature, "utf8");
    const signatureBuffer = Buffer.from(razorpaySignature.trim(), "utf8");

    if (
      expectedBuffer.length !== signatureBuffer.length ||
      !crypto.timingSafeEqual(expectedBuffer, signatureBuffer)
    ) {
      throw new UnauthorizedError("Invalid payment signature");
    }
  }

  // 3. Idempotent check: already completed?
  if (purchase.status === PurchaseStatus.COMPLETED) {
    const activeSub = await getUserSubscription(userId);
    return {
      message: "Subscription purchase already activated.",
      purchase,
      subscription: activeSub.subscription,
    };
  }

  // 4. Activate in an atomic transaction
  const now = new Date();
  const packDef = PACK_CATALOG[purchase.packType];
  const durationMonths = purchase.plusDurationMonths || packDef?.plusDurationMonths || 12;

  const result = await prisma.$transaction(async (tx) => {
    const updatedPurchase = await tx.subscriptionPurchase.update({
      where: { id: purchase.id },
      data: {
        status: PurchaseStatus.COMPLETED,
        paymentProvider: "RAZORPAY",
        providerOrderId: razorpayOrderId,
        providerPaymentId: razorpayPaymentId,
        completedAt: now,
      },
    });

    const updatedSub = await activateUserPlusSubscription(tx, userId, durationMonths, "paid");

    return { purchase: updatedPurchase, subscription: updatedSub };
  });

  return {
    message: `Payment verified successfully! Plus plan activated for ${durationMonths} months.`,
    purchase: result.purchase,
    subscription: result.subscription,
  };
};

/**
 * Idempotently reconciles a payment.captured webhook event for subscription purchases.
 */
export const reconcileCapturedSubscriptionPayment = async (input: {
  providerOrderId: string;
  providerPaymentId: string;
  amount: number;
  currency?: string;
  rawPayload?: any;
}): Promise<void> => {
  const { providerOrderId, providerPaymentId, amount, currency = "INR", rawPayload } = input;

  const purchase = await prisma.subscriptionPurchase.findFirst({
    where: { providerOrderId },
  });

  if (!purchase) {
    throw new NotFoundError(
      `No subscription purchase record found matching Razorpay Order ID ${providerOrderId}`
    );
  }

  if (amount !== purchase.amountPaise) {
    throw new Error(
      `Payment amount mismatch for purchase ${purchase.id}: expected ${purchase.amountPaise}, received ${amount}`
    );
  }

  if (currency !== purchase.currency) {
    throw new Error(
      `Payment currency mismatch for purchase ${purchase.id}: expected ${purchase.currency}, received ${currency}`
    );
  }

  // Idempotency: If already completed, nothing to do
  if (purchase.status === PurchaseStatus.COMPLETED) {
    return;
  }

  const now = new Date();
  const packDef = PACK_CATALOG[purchase.packType];
  const durationMonths = purchase.plusDurationMonths || packDef?.plusDurationMonths || 12;

  await prisma.$transaction(async (tx) => {
    await tx.subscriptionPurchase.update({
      where: { id: purchase.id },
      data: {
        status: PurchaseStatus.COMPLETED,
        providerPaymentId,
        completedAt: now,
        metadata: rawPayload
          ? (rawPayload as Prisma.InputJsonValue)
          : purchase.metadata ?? Prisma.JsonNull,
      },
    });

    await activateUserPlusSubscription(tx, purchase.userId, durationMonths, "paid");
  });
};

/**
 * Reconciles a payment.failed webhook event for subscription purchases.
 */
export const reconcileFailedSubscriptionPayment = async (input: {
  providerOrderId: string;
  providerPaymentId?: string;
  failureCode?: string;
  failureDescription?: string;
  rawPayload?: any;
}): Promise<void> => {
  const { providerOrderId, providerPaymentId, failureCode, failureDescription } = input;

  const purchase = await prisma.subscriptionPurchase.findFirst({
    where: { providerOrderId },
  });

  if (!purchase || purchase.status === PurchaseStatus.COMPLETED) {
    return;
  }

  await prisma.subscriptionPurchase.update({
    where: { id: purchase.id },
    data: {
      status: PurchaseStatus.FAILED,
      providerPaymentId: providerPaymentId ?? purchase.providerPaymentId,
      metadata: {
        ...((purchase.metadata as any) || {}),
        failureCode,
        failureDescription,
        failedAt: new Date().toISOString(),
      },
    },
  });
};

/**
 * Activates a 12-month Plus subscription upon purchase completion.
 * If user has existing active Plus subscription, extends duration by 12 months.
 * Restores any previously SUSPENDED tags back to ASSIGNED (up to 8 tag limit).
 */
export const activatePackPurchase = async (
  userId: string,
  options: {
    purchaseId?: string;
    packType?: PurchasePackType;
    paymentProvider?: string;
    providerOrderId?: string;
    providerPaymentId?: string;
  }
) => {
  let targetPackType = options.packType;
  let targetPurchaseId = options.purchaseId;

  if (targetPurchaseId) {
    const existing = await prisma.subscriptionPurchase.findUnique({
      where: { id: targetPurchaseId },
    });
    if (!existing) {
      throw new NotFoundError("Purchase record not found");
    }
    targetPackType = existing.packType;
  } else if (!targetPackType) {
    throw new BadRequestError("Either purchaseId or packType must be provided.");
  }

  const packDef = PACK_CATALOG[targetPackType];
  if (!packDef) {
    throw new BadRequestError(`Invalid pack type: ${targetPackType}`);
  }

  const now = new Date();
  const currentSub = await prisma.subscription.findUnique({
    where: { userId },
  });

  // Calculate new expiration date:
  // If user already has an active Plus subscription that expires in the future, extend it by 12 months!
  let baseDate = now;
  if (
    currentSub &&
    currentSub.tier === SubscriptionTier.PLUS &&
    currentSub.expiresAt &&
    currentSub.expiresAt > now
  ) {
    baseDate = currentSub.expiresAt;
  }

  const newExpiresAt = new Date(baseDate);
  newExpiresAt.setFullYear(newExpiresAt.getFullYear() + (packDef.plusDurationMonths ? Math.round(packDef.plusDurationMonths / 12) : 1));

  const plusConfig = PLAN_CONFIGS[SubscriptionTier.PLUS];

  const result = await prisma.$transaction(async (tx) => {
    // 1. Record completed purchase snapshot
    let purchaseRecord;
    if (targetPurchaseId) {
      purchaseRecord = await tx.subscriptionPurchase.update({
        where: { id: targetPurchaseId },
        data: {
          status: PurchaseStatus.COMPLETED,
          completedAt: now,
          providerOrderId: options.providerOrderId ?? null,
          providerPaymentId: options.providerPaymentId ?? null,
        },
      });
    } else {
      purchaseRecord = await tx.subscriptionPurchase.create({
        data: {
          userId,
          packType: targetPackType!,
          amountPaise: packDef.amountPaise,
          currency: packDef.currency,
          tagsIncluded: packDef.tagsIncluded,
          plusDurationMonths: packDef.plusDurationMonths,
          status: PurchaseStatus.COMPLETED,
          paymentProvider: options.paymentProvider || "MANUAL",
          providerOrderId: options.providerOrderId ?? null,
          providerPaymentId: options.providerPaymentId ?? null,
          completedAt: now,
        },
      });
    }

    // 2. Upgrade / Extend User's Subscription to PLUS
    const updatedSub = await tx.subscription.upsert({
      where: { userId },
      create: {
        userId,
        tier: SubscriptionTier.PLUS,
        maxActiveTags: plusConfig.maxActiveTags,
        hasWhatsappAlerts: plusConfig.hasWhatsappAlerts,
        hasAnalytics: plusConfig.hasAnalytics,
        isFupFlagged: false,
        gracePeriodDays: plusConfig.gracePeriodDays,
        startsAt: now,
        expiresAt: newExpiresAt,
      },
      update: {
        tier: SubscriptionTier.PLUS,
        maxActiveTags: plusConfig.maxActiveTags,
        hasWhatsappAlerts: plusConfig.hasWhatsappAlerts,
        hasAnalytics: plusConfig.hasAnalytics,
        isFupFlagged: false,
        gracePeriodDays: plusConfig.gracePeriodDays,
        expiresAt: newExpiresAt,
      },
    });

    // 3. Restore any previously SUSPENDED tags back to ASSIGNED (up to 8 total)
    const suspendedTags = await tx.qrTag.findMany({
      where: {
        resource: { userId, active: true },
        status: QrTagStatus.SUSPENDED,
      },
      take: plusConfig.maxActiveTags,
    });

    for (const tag of suspendedTags) {
      await tx.qrTag.update({
        where: { id: tag.id },
        data: { status: QrTagStatus.ASSIGNED },
      });
    }

    return { purchase: purchaseRecord, subscription: updatedSub };
  });

  return {
    message: `Successfully activated 12-month Plus subscription with ${packDef.name}!`,
    purchase: result.purchase,
    subscription: result.subscription,
  };
};

/**
 * Returns user's purchase history.
 */
export const getUserPurchases = async (userId: string) => {
  const purchases = await prisma.subscriptionPurchase.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });

  return purchases.map((p) => ({
    ...p,
    packDetails: PACK_CATALOG[p.packType] || null,
  }));
};

/**
 * Transactionally activates or extends a user's PLUS subscription for a specified duration in months.
 * Restores any previously SUSPENDED tags back to ASSIGNED (up to maxActiveTags limit).
 */
/**
 * Activates or extends a user's subscription based on a database-backed Plan.
 * Sets maxActiveTags and durationDays from the resolved Plan.
 * Restores any previously SUSPENDED tags back to ASSIGNED (up to maxActiveTags limit).
 */
export const activateUserPlusSubscription = async (
  tx: Prisma.TransactionClient,
  userId: string,
  durationMonths?: number,
  source: string = "included_with_order",
  planId?: string | null
) => {
  const now = new Date();

  // 1. Resolve Plan from database (default to STARTER)
  let plan = null;
  if (planId) {
    plan = await tx.plan.findUnique({ where: { id: planId } });
  }
  if (!plan) {
    plan = await tx.plan.findUnique({ where: { code: "STARTER" } });
  }

  const tagQuota = plan?.tagQuota ?? 4;
  const durationDays = plan?.durationDays ?? (durationMonths && durationMonths > 0 ? durationMonths * 30 : 365);
  const resolvedPlanId = plan?.id ?? null;

  const currentSub = await tx.subscription.findUnique({
    where: { userId },
  });

  let baseDate = now;
  if (
    currentSub &&
    currentSub.tier === SubscriptionTier.PLUS &&
    currentSub.expiresAt &&
    currentSub.expiresAt > now
  ) {
    baseDate = currentSub.expiresAt;
  }

  const newExpiresAt = new Date(baseDate.getTime() + durationDays * 24 * 60 * 60 * 1000);

  const plusConfig = PLAN_CONFIGS[SubscriptionTier.PLUS];

  const updatedSub = await tx.subscription.upsert({
    where: { userId },
    create: {
      userId,
      planId: resolvedPlanId,
      tier: SubscriptionTier.PLUS,
      maxActiveTags: tagQuota,
      hasWhatsappAlerts: plusConfig.hasWhatsappAlerts,
      hasAnalytics: plusConfig.hasAnalytics,
      isFupFlagged: false,
      gracePeriodDays: plusConfig.gracePeriodDays,
      startsAt: now,
      expiresAt: newExpiresAt,
      source,
    },
    update: {
      planId: resolvedPlanId,
      tier: SubscriptionTier.PLUS,
      maxActiveTags: tagQuota,
      hasWhatsappAlerts: plusConfig.hasWhatsappAlerts,
      hasAnalytics: plusConfig.hasAnalytics,
      isFupFlagged: false,
      gracePeriodDays: plusConfig.gracePeriodDays,
      expiresAt: newExpiresAt,
      source,
    },
  });

  const suspendedTags = await tx.qrTag.findMany({
    where: {
      resource: { userId, active: true },
      status: QrTagStatus.SUSPENDED,
    },
    take: tagQuota,
  });

  for (const tag of suspendedTags) {
    await tx.qrTag.update({
      where: { id: tag.id },
      data: { status: QrTagStatus.ASSIGNED },
    });
  }

  return updatedSub;
};

export const activateUserPlan = async (
  tx: Prisma.TransactionClient,
  userId: string,
  planId?: string | null,
  source: string = "included_with_order"
) => {
  return await activateUserPlusSubscription(tx, userId, undefined, source, planId);
};
