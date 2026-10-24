import {
  Prisma,
  PurchasePackType,
  PurchaseStatus,
  QrTagStatus,
  SubscriptionTier,
} from "@prisma/client";
import { BadRequestError, NotFoundError } from "../../errors/AppError.js";
import { prisma } from "../../lib/prisma.js";
import { PACK_CATALOG, PLAN_CONFIGS } from "./subscriptions.types.js";

/**
 * Returns user's active subscription, automatically creating default BASIC plan if none exists,
 * and deriving status directly from tier and expiresAt.
 *
 * Rules:
 * - BASIC with expiresAt = null means permanent lifetime access.
 * - PLUS with a future expiresAt means active paid access.
 * - PLUS with an elapsed expiresAt means entitlement has expired -> resets row to BASIC.
 */
export const getUserSubscription = async (userId: string) => {
  let subscription = await prisma.subscription.findUnique({
    where: { userId },
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
    });
  }

  // 2. Fetch user's currently paired QR tags (both ASSIGNED and SUSPENDED)
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

  let isExpired = false;
  let needsTagSelection = false;

  // 3. Dynamic Entitlement & Expiration Check
  if (
    subscription.tier === SubscriptionTier.PLUS &&
    subscription.expiresAt &&
    subscription.expiresAt < now
  ) {
    isExpired = true;
    const basicConfig = PLAN_CONFIGS[SubscriptionTier.BASIC];

    // If user has more tags than Basic allows (2), flag for tag selection
    if (assignedTags.length > basicConfig.maxActiveTags) {
      needsTagSelection = true;
    }

    // Reset subscription row to BASIC with permanent lifetime calling
    subscription = await prisma.subscription.update({
      where: { userId },
      data: {
        tier: SubscriptionTier.BASIC,
        maxActiveTags: basicConfig.maxActiveTags,
        hasWhatsappAlerts: basicConfig.hasWhatsappAlerts,
        hasAnalytics: basicConfig.hasAnalytics,
        expiresAt: null,
      },
    });
  } else if (
    subscription.tier === SubscriptionTier.BASIC &&
    assignedTags.length > subscription.maxActiveTags
  ) {
    // Basic user with more than 2 assigned tags
    needsTagSelection = true;
  }

  // Derive status cleanly without database status column drift
  const derivedStatus =
    subscription.tier === SubscriptionTier.PLUS
      ? subscription.expiresAt && subscription.expiresAt >= now
        ? "ACTIVE"
        : "EXPIRED"
      : "ACTIVE";

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
      status: derivedStatus,
      maxActiveTags: subscription.maxActiveTags,
      hasLifetimeCalling: true,
      hasWhatsappAlerts: subscription.hasWhatsappAlerts,
      hasAnalytics: subscription.hasAnalytics,
      startsAt: subscription.startsAt,
      expiresAt: subscription.expiresAt,
      daysRemaining,
      isExpired,
    },
    tags: {
      activeCount: assignedTags.length,
      suspendedCount: suspendedTags.length,
      totalCount: pairedTags.length,
      maxLimit: subscription.maxActiveTags,
      needsTagSelection,
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
    catalog: Object.values(PACK_CATALOG),
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
 * Initiates a purchase for a pack using server-side configuration.
 */
export const createPackPurchase = async (
  userId: string,
  packType: PurchasePackType,
  paymentProvider = "MANUAL",
  metadata?: Prisma.InputJsonValue
) => {
  const packDef = PACK_CATALOG[packType];
  if (!packDef) {
    throw new BadRequestError(`Invalid pack type: ${packType}`);
  }

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

  return {
    purchase,
    pack: packDef,
  };
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
        startsAt: now,
        expiresAt: newExpiresAt,
      },
      update: {
        tier: SubscriptionTier.PLUS,
        maxActiveTags: plusConfig.maxActiveTags,
        hasWhatsappAlerts: plusConfig.hasWhatsappAlerts,
        hasAnalytics: plusConfig.hasAnalytics,
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
