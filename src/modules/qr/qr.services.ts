import crypto from "node:crypto";
import { prisma } from "../../lib/prisma.js";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "../../errors/AppError.js";
import { GrantStatus, QrAssignmentMethod, QrTagOrigin, QrTagStatus, QrTagStockState } from "@prisma/client";
import { getUserSubscription, activateUserPlusSubscription } from "../subscriptions/subscriptions.services.js";

// Crockford-style character sets excluding visually ambiguous characters: 0, 1, I, O, L
const LETTER_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ"; // 23 letters (no I, L, O)
const ALPHANUMERIC_CHARS = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"; // 31 chars (no 0, 1, I, L, O)

/**
 * Generate a short, clean, human-readable tag number (e.g., "KT83B45").
 * Fixed format: 2 uppercase letters + 5 alphanumeric characters.
 * Space: 24 * 24 * 31^5 = ~16.5 billion unique combinations.
 */
export const generateTagNumber = (): string => {
  let tag = "";
  for (let i = 0; i < 2; i++) {
    tag += LETTER_CHARS[crypto.randomInt(0, LETTER_CHARS.length)];
  }
  for (let i = 0; i < 5; i++) {
    tag += ALPHANUMERIC_CHARS[crypto.randomInt(0, ALPHANUMERIC_CHARS.length)];
  }
  return tag;
};

/**
 * Generate an independent, cryptographically random high-entropy token for the QR code payload.
 * Never derived from tagNumber.
 */
export const generateOpaqueToken = (): string => {
  return crypto.randomBytes(24).toString("base64url");
};

/**
 * Hash a raw QR token string into a SHA-256 hex digest for database storage and lookups.
 * The physical QR sticker encodes the raw token; the database stores only the hash.
 */
export const hashQrToken = (token: string): string => {
  return crypto.createHash("sha256").update(token.trim()).digest("hex");
};

/**
 * Check the status and details of a QR tag by either its raw scanned token OR human-readable tagNumber.
 * Can be called publicly (camera scan) or by customer support.
 */
export const getQrTagDetails = async (identifier: string) => {
  const trimmed = identifier.trim();
  const tokenHash = hashQrToken(trimmed);
  const normalizedTagNumber = trimmed.toUpperCase();

  // Search by tokenHash OR tagNumber
  const tag = await prisma.qrTag.findFirst({
    where: {
      OR: [
        { tokenHash },
        { tagNumber: normalizedTagNumber },
      ],
    },
    include: {
      resource: {
        select: {
          id: true,
          userId: true,
          name: true,
          type: true,
          vehicleDetail: true,
          contactLink: {
            select: {
              token: true,
              active: true,
            },
          },
        },
      },
    },
  });

  if (!tag) {
    throw new NotFoundError("QR tag not recognized. Please verify the tag number or token.");
  }

  if (tag.status === QrTagStatus.REVOKED) {
    throw new BadRequestError("This QR tag has been deactivated and cannot be used.");
  }

  return {
    tagId: tag.id,
    tagNumber: tag.tagNumber,
    origin: tag.origin,
    status: tag.status,
    isAssigned: tag.status === QrTagStatus.ASSIGNED && Boolean(tag.resourceId),
    pairedResource: tag.resource
      ? {
          id: tag.resource.id,
          name: tag.resource.name,
          type: tag.resource.type,
          registrationNum: tag.resource.vehicleDetail?.registrationNum ?? null,
          vehicleColour: tag.resource.vehicleDetail?.vehicleColour ?? null,
          contactToken: tag.resource.contactLink?.token ?? null,
        }
      : null,
  };
};

/**
 * Public tag resolver: Resolves a physical tag token (/t/:token) to its current status or contact page.
 *
 * Cases:
 * 1. ASSIGNED: Returns action "CONTACT" with contactToken and redirectUrl to /contact/:contactToken.
 * 2. UNASSIGNED: Returns action "PAIR" with claim token and redirectUrl to /pair/:token.
 * 3. REVOKED: Returns action "REVOKED" with deactivated message.
 */
export const resolveTagToken = async (rawToken: string) => {
  const trimmed = rawToken.trim();
  const tokenHash = hashQrToken(trimmed);
  const normalizedTagNumber = trimmed.toUpperCase();

  const tag = await prisma.qrTag.findFirst({
    where: {
      OR: [
        { tokenHash },
        { tagNumber: normalizedTagNumber },
      ],
    },
    include: {
      resource: {
        select: {
          id: true,
          name: true,
          type: true,
          active: true,
          vehicleDetail: {
            select: {
              registrationNum: true,
              vehicleColour: true,
            },
          },
          contactLink: {
            select: {
              token: true,
              active: true,
            },
          },
        },
      },
    },
  });

  if (!tag) {
    throw new NotFoundError("QR tag not recognized. Please verify the tag or QR code.");
  }

  if (tag.status === QrTagStatus.REVOKED) {
    return {
      status: QrTagStatus.REVOKED,
      action: "REVOKED" as const,
      tagNumber: tag.tagNumber,
      message: "This QR tag has been deactivated and is no longer active.",
      redirectUrl: `/tag/revoked?tag=${tag.tagNumber}`,
    };
  }

  if (tag.status === QrTagStatus.SUSPENDED) {
    return {
      status: QrTagStatus.SUSPENDED,
      action: "SUSPENDED" as const,
      tagNumber: tag.tagNumber,
      message: "This QR tag is currently suspended due to subscription plan limits.",
      redirectUrl: `/tag/suspended?tag=${tag.tagNumber}`,
    };
  }

  if (tag.status === QrTagStatus.UNASSIGNED || !tag.resourceId || !tag.resource) {
    return {
      status: QrTagStatus.UNASSIGNED,
      action: "PAIR" as const,
      tagNumber: tag.tagNumber,
      claimToken: trimmed,
      message: "This tag is unassigned and ready to be paired.",
      redirectUrl: `/pair/${encodeURIComponent(trimmed)}`,
    };
  }

  const contactToken = tag.resource.contactLink?.token;
  if (!contactToken || !tag.resource.contactLink?.active) {
    throw new NotFoundError("The vehicle linked to this tag does not have an active contact page.");
  }

  return {
    status: QrTagStatus.ASSIGNED,
    action: "CONTACT" as const,
    tagNumber: tag.tagNumber,
    contactToken,
    redirectUrl: `/contact/${contactToken}`,
    resource: {
      id: tag.resource.id,
      name: tag.resource.name,
      type: tag.resource.type,
      registrationNum: tag.resource.vehicleDetail?.registrationNum ?? null,
      vehicleColour: tag.resource.vehicleDetail?.vehicleColour ?? null,
    },
  };
};

export interface PairQrTagInput {
  userId: string;
  resourceId: string;
  qrToken?: string | undefined;
  tagNumber?: string | undefined;
  replaceExistingOnResource?: boolean | undefined;
}

/**
 * Pair a physical/digital QR tag to a resource.
 *
 * Security & Integrity guarantees:
 * 1. The logged-in user MUST own the target resource.
 * 2. If the QR tag is already ASSIGNED:
 *    - To another user -> Throws ConflictError (cannot steal someone else's tag).
 *    - To the same resource -> Idempotent success (already paired).
 *    - To another resource belonging to the SAME user -> Gracefully reassigns the tag to the new resource.
 * 3. If the target resource already has a DIFFERENT tag assigned:
 *    - Throws ConflictError unless replaceExistingOnResource is explicitly true.
 * 4. Atomically updates QrTag and records audit trail in QrAssignment.
 */
export const pairQrTag = async ({
  userId,
  resourceId,
  qrToken,
  tagNumber,
  replaceExistingOnResource = false,
}: PairQrTagInput) => {
  if (!qrToken && !tagNumber) {
    throw new BadRequestError("Must provide either qrToken (from scan) or tagNumber (from sticker text).");
  }

  // 1. Verify user owns the target resource
  const targetResource = await prisma.resource.findFirst({
    where: {
      id: resourceId,
      userId,
      active: true,
    },
    include: {
      vehicleDetail: true,
      qrTag: true,
    },
  });

  if (!targetResource) {
    throw new NotFoundError("Resource not found or does not belong to your account.");
  }

  // 2. Locate the QR tag via token hash or tagNumber
  const whereClause = qrToken
    ? { tokenHash: hashQrToken(qrToken) }
    : { tagNumber: tagNumber!.trim().toUpperCase() };

  const tag = await prisma.qrTag.findUnique({
    where: whereClause,
    include: {
      resource: {
        select: {
          id: true,
          userId: true,
          name: true,
        },
      },
    },
  });

  if (!tag) {
    throw new NotFoundError("QR tag not recognized. Please scan a valid tag or check the tag number.");
  }

  if (tag.status === QrTagStatus.REVOKED) {
    throw new BadRequestError("This QR tag has been revoked and cannot be paired.");
  }

  // 2b. Commerce / Inventory Check: Preprinted tags must have been sold/allocated
  const stockRecord = await prisma.qrTagInventory.findUnique({
    where: { qrTagId: tag.id },
  });
  if (stockRecord) {
    const allowedStates: QrTagStockState[] = [
      QrTagStockState.ALLOCATED_TO_ORDER,
      QrTagStockState.DISPATCHED,
      QrTagStockState.DELIVERED,
    ];
    if (!allowedStates.includes(stockRecord.state)) {
      throw new ForbiddenError(
        `This QR tag is not eligible for pairing (current state: ${stockRecord.state}).`
      );
    }
  }

  // 3. FOOLPROOF CHECK: Prevent claiming an already assigned tag without owner permission
  if (tag.status === QrTagStatus.ASSIGNED && tag.resource) {
    // If assigned to a different user, REJECT!
    if (tag.resource.userId !== userId) {
      throw new ConflictError(
        "This QR tag is already registered to another user's account. It must be unassigned by its owner first."
      );
    }

    // If already assigned to this exact resource, it's a no-op
    if (tag.resourceId === resourceId) {
      return {
        message: "QR tag is already paired to this resource.",
        tag: {
          id: tag.id,
          tagNumber: tag.tagNumber,
          status: tag.status,
          resourceId: tag.resourceId,
          assignedAt: tag.assignedAt,
        },
        resource: {
          id: targetResource.id,
          name: targetResource.name,
        },
      };
    }
  }

  // 4. Check if the target resource already has a different QR tag paired
  const existingTagOnTargetResource = await prisma.qrTag.findUnique({
    where: { resourceId },
  });

  if (existingTagOnTargetResource && existingTagOnTargetResource.id !== tag.id) {
    if (!replaceExistingOnResource) {
      throw new ConflictError(
        `This resource already has a different QR tag assigned (${existingTagOnTargetResource.tagNumber}). Set replaceExistingOnResource to true to replace it.`
      );
    }
  }

  // 4b. Enforce active tag limits from user's subscription
  const isReplacingOnResource = Boolean(
    existingTagOnTargetResource &&
      existingTagOnTargetResource.id !== tag.id &&
      existingTagOnTargetResource.status === QrTagStatus.ASSIGNED
  );
  const isMovingOwnAssignedTag = Boolean(
    tag.status === QrTagStatus.ASSIGNED && tag.resource?.userId === userId
  );

  if (!isReplacingOnResource && !isMovingOwnAssignedTag) {
    const { subscription, tags } = await getUserSubscription(userId);

    // If user has a pending PLUS grant waiting to be redeemed upon pairing, allow up to Plus limits (8)
    const hasPendingPlusGrant = await prisma.subscriptionGrant.findFirst({
      where: {
        userId,
        status: GrantStatus.PENDING_PAIRING,
      },
    });

    const maxLimit = hasPendingPlusGrant ? 8 : subscription.maxActiveTags;
    if (tags.activeCount >= maxLimit) {
      throw new ForbiddenError(
        `Active tag limit reached (${tags.activeCount}/${maxLimit}) on your account.`
      );
    }
  }

  const now = new Date();

  // 5. Execute pairing inside an atomic transaction
  const result = await prisma.$transaction(async (tx) => {
    // Case A: If target resource had an old tag and we are replacing it, unassign that old tag
    if (existingTagOnTargetResource && existingTagOnTargetResource.id !== tag.id) {
      await tx.qrAssignment.updateMany({
        where: {
          qrTagId: existingTagOnTargetResource.id,
          resourceId: targetResource.id,
          unassignedAt: null,
        },
        data: {
          unassignedAt: now,
        },
      });

      await tx.qrTag.update({
        where: { id: existingTagOnTargetResource.id },
        data: {
          status: QrTagStatus.UNASSIGNED,
          resourceId: null,
          assignmentMethod: null,
          assignedAt: null,
        },
      });
    }

    // Case B: If this tag was previously paired to another resource owned by this user, close the old assignment
    if (tag.status === QrTagStatus.ASSIGNED && tag.resourceId && tag.resourceId !== resourceId) {
      await tx.qrAssignment.updateMany({
        where: {
          qrTagId: tag.id,
          resourceId: tag.resourceId,
          unassignedAt: null,
        },
        data: {
          unassignedAt: now,
        },
      });
    }

    // Update the tag to point to the new resource
    const updatedTag = await tx.qrTag.update({
      where: { id: tag.id },
      data: {
        status: QrTagStatus.ASSIGNED,
        resourceId: targetResource.id,
        assignmentMethod: QrAssignmentMethod.USER_PAIRED,
        assignedAt: now,
      },
    });

    // Create the new active assignment record in the audit log
    const newAssignment = await tx.qrAssignment.create({
      data: {
        qrTagId: tag.id,
        resourceId: targetResource.id,
        method: QrAssignmentMethod.USER_PAIRED,
        assignedAt: now,
        unassignedAt: null,
      },
    });

    // Step 5: Subscription is account-level. Check if this account has an unredeemed PLUS grant.
    // 1. First check if the user already has a grant linked to their userId
    let grantToRedeem = await tx.subscriptionGrant.findFirst({
      where: {
        userId,
        status: GrantStatus.PENDING_PAIRING,
        createdAt: { lte: now },
      },
      orderBy: { createdAt: "asc" },
    });

    // 2. Fallback: Tag was allocated to an order that has an unredeemed grant (e.g. Guest checkout)
    if (!grantToRedeem) {
      const allocation = await tx.orderTagAllocation.findFirst({
        where: { qrTagId: tag.id },
        include: {
          order: {
            include: {
              subscriptionGrants: {
                where: {
                  status: { in: [GrantStatus.PENDING_CLAIM, GrantStatus.PENDING_PAIRING] },
                },
              },
            },
          },
        },
      });

      const orderGrant = allocation?.order?.subscriptionGrants?.[0];
      if (orderGrant) {
        if (!allocation.order.userId) {
          await tx.order.update({
            where: { id: allocation.order.id },
            data: { userId },
          });
        }
        grantToRedeem = orderGrant;
      }
    }

    // 3. Fallback: Any paid order with customerPhone matching user's phone that has an unredeemed grant
    if (!grantToRedeem) {
      const userRecord = await tx.user.findUnique({
        where: { id: userId },
        select: { mobileNumber: true },
      });
      if (userRecord?.mobileNumber) {
        const matchingOrder = await tx.order.findFirst({
          where: {
            customerPhone: userRecord.mobileNumber,
            subscriptionGrants: {
              some: {
                status: { in: [GrantStatus.PENDING_CLAIM, GrantStatus.PENDING_PAIRING] },
              },
            },
          },
          include: {
            subscriptionGrants: {
              where: {
                status: { in: [GrantStatus.PENDING_CLAIM, GrantStatus.PENDING_PAIRING] },
              },
            },
          },
        });

        const phoneGrant = matchingOrder?.subscriptionGrants?.[0];
        if (phoneGrant) {
          if (!matchingOrder.userId) {
            await tx.order.update({
              where: { id: matchingOrder.id },
              data: { userId },
            });
          }
          grantToRedeem = phoneGrant;
        }
      }
    }

    let activatedPlus = false;
    let plusDurationMonths = 0;
    if (grantToRedeem) {
      const redeemed = await tx.subscriptionGrant.updateMany({
        where: {
          id: grantToRedeem.id,
          status: { in: [GrantStatus.PENDING_PAIRING, GrantStatus.PENDING_CLAIM] },
        },
        data: {
          userId,
          status: GrantStatus.ACTIVATED,
          activatedAt: now,
          triggeringQrTagId: tag.id,
        },
      });

      if (redeemed.count === 1) {
        await activateUserPlusSubscription(tx, userId, grantToRedeem.plusDurationMonths);
        activatedPlus = true;
        plusDurationMonths = grantToRedeem.plusDurationMonths;
      }
    }

    return { updatedTag, newAssignment, activatedPlus, plusDurationMonths };
  });

  return {
    message: result.activatedPlus
      ? `QR tag successfully paired! PLUS subscription activated for ${result.plusDurationMonths} months.`
      : "QR tag successfully paired under BASIC plan.",
    activatedPlus: result.activatedPlus,
    plusDurationMonths: result.plusDurationMonths,
    tag: {
      id: result.updatedTag.id,
      tagNumber: result.updatedTag.tagNumber,
      status: result.updatedTag.status,
      resourceId: result.updatedTag.resourceId,
      assignedAt: result.updatedTag.assignedAt,
      assignmentMethod: result.updatedTag.assignmentMethod,
    },
    resource: {
      id: targetResource.id,
      name: targetResource.name,
      type: targetResource.type,
      registrationNum: targetResource.vehicleDetail?.registrationNum ?? null,
    },
  };
};

export interface UnpairQrTagInput {
  userId: string;
  tagId?: string | undefined;
  qrToken?: string | undefined;
  tagNumber?: string | undefined;
  resourceId?: string | undefined;
}

/**
 * Unpair / de-allocate a QR tag from a resource.
 *
 * Security & Integrity guarantees:
 * 1. The logged-in user MUST own the resource currently linked to the QR tag.
 * 2. Closes the active QrAssignment row (sets unassignedAt timestamp).
 * 3. Resets QrTag to UNASSIGNED and clears resourceId.
 */
export const unpairQrTag = async ({
  userId,
  tagId,
  qrToken,
  tagNumber,
  resourceId,
}: UnpairQrTagInput) => {
  if (!tagId && !qrToken && !tagNumber && !resourceId) {
    throw new BadRequestError("Must provide tagId, qrToken, tagNumber, or resourceId to unpair.");
  }

  let tag = null;

  if (tagId) {
    tag = await prisma.qrTag.findUnique({
      where: { id: tagId },
      include: {
        resource: {
          select: { id: true, userId: true, name: true },
        },
      },
    });
  } else if (tagNumber) {
    tag = await prisma.qrTag.findUnique({
      where: { tagNumber: tagNumber.trim().toUpperCase() },
      include: {
        resource: {
          select: { id: true, userId: true, name: true },
        },
      },
    });
  } else if (qrToken) {
    const tokenHash = hashQrToken(qrToken);
    tag = await prisma.qrTag.findUnique({
      where: { tokenHash },
      include: {
        resource: {
          select: { id: true, userId: true, name: true },
        },
      },
    });
  } else if (resourceId) {
    tag = await prisma.qrTag.findUnique({
      where: { resourceId },
      include: {
        resource: {
          select: { id: true, userId: true, name: true },
        },
      },
    });
  }

  if (!tag) {
    throw new NotFoundError("QR tag not found.");
  }

  if (tag.status !== QrTagStatus.ASSIGNED || !tag.resourceId || !tag.resource) {
    throw new BadRequestError("This QR tag is not currently paired to any resource.");
  }

  // FOOLPROOF PERMISSION CHECK: Must be the owner of the resource
  if (tag.resource.userId !== userId) {
    throw new ForbiddenError("You are not authorized to unpair this QR tag.");
  }

  const now = new Date();
  const detachedResourceId = tag.resourceId;

  await prisma.$transaction(async (tx) => {
    // 1. Close active assignment audit records
    await tx.qrAssignment.updateMany({
      where: {
        qrTagId: tag.id,
        resourceId: detachedResourceId,
        unassignedAt: null,
      },
      data: {
        unassignedAt: now,
      },
    });

    // 2. Reset the tag to unassigned
    await tx.qrTag.update({
      where: { id: tag.id },
      data: {
        status: QrTagStatus.UNASSIGNED,
        resourceId: null,
        assignmentMethod: null,
        assignedAt: null,
      },
    });
  });

  return {
    message: "QR tag successfully unassigned.",
    tagId: tag.id,
    tagNumber: tag.tagNumber,
    unassignedResourceId: detachedResourceId,
  };
};

export interface GeneratedTagItem {
  tagNumber: string;
  token: string;
  tokenHash: string;
}

import redis from "../../lib/redis.js";

export interface GenerateSingleTagInput {
  userId: string;
  resourceId?: string | undefined;
  origin?: QrTagOrigin | undefined;
}

/**
 * Generate a single QR tag on-demand.
 * Can be requested by:
 * 1. An authenticated user for an unpaired resource -> automatically pairs it (origin: GENERATED_FOR_RESOURCE)
 * 2. An authenticated user or admin without resourceId -> creates an unassigned tag
 */
export const generateSingleTag = async ({
  userId,
  resourceId,
  origin,
}: GenerateSingleTagInput) => {
  const publicAppUrl = process.env.PUBLIC_APP_URL || "https://pingin.co.in";

  // Case 1: Tag requested directly for a specific resource
  if (resourceId) {
    const resource = await prisma.resource.findFirst({
      where: {
        id: resourceId,
        userId,
        active: true,
      },
      include: {
        vehicleDetail: true,
      },
    });

    if (!resource) {
      throw new NotFoundError("Resource not found or does not belong to your account.");
    }

    const existingTag = await prisma.qrTag.findUnique({
      where: { resourceId },
    });

    if (existingTag) {
      throw new ConflictError(
        `This resource already has an active QR tag (${existingTag.tagNumber}). Please unpair it before generating a new one.`
      );
    }

    let tagNumber = generateTagNumber();
    while (await prisma.qrTag.findUnique({ where: { tagNumber } })) {
      tagNumber = generateTagNumber();
    }

    const token = generateOpaqueToken();
    const tokenHash = hashQrToken(token);
    const now = new Date();

    const createdTag = await prisma.$transaction(async (tx) => {
      const tag = await tx.qrTag.create({
        data: {
          tagNumber,
          tokenHash,
          origin: origin ?? QrTagOrigin.GENERATED_FOR_RESOURCE,
          status: QrTagStatus.ASSIGNED,
          resourceId: resource.id,
          assignmentMethod: QrAssignmentMethod.SYSTEM_BOUND,
          assignedAt: now,
        },
      });

      await tx.qrAssignment.create({
        data: {
          qrTagId: tag.id,
          resourceId: resource.id,
          method: QrAssignmentMethod.SYSTEM_BOUND,
          assignedAt: now,
          unassignedAt: null,
        },
      });

      return tag;
    });

    return {
      message: "Single QR tag generated and paired successfully.",
      tag: {
        id: createdTag.id,
        tagNumber: createdTag.tagNumber,
        token, // returned once upon creation so frontend can render QR code
        qrUrl: `${publicAppUrl}/t/${token}`,
        origin: createdTag.origin,
        status: createdTag.status,
        resourceId: createdTag.resourceId,
        assignedAt: createdTag.assignedAt,
      },
      resource: {
        id: resource.id,
        name: resource.name,
        type: resource.type,
        registrationNum: resource.vehicleDetail?.registrationNum ?? null,
      },
    };
  }

  // Case 2: Unassigned tag generated on-demand
  let tagNumber = generateTagNumber();
  while (await prisma.qrTag.findUnique({ where: { tagNumber } })) {
    tagNumber = generateTagNumber();
  }

  const token = generateOpaqueToken();
  const tokenHash = hashQrToken(token);

  const tag = await prisma.qrTag.create({
    data: {
      tagNumber,
      tokenHash,
      origin: origin ?? QrTagOrigin.GENERATED_FOR_RESOURCE,
      status: QrTagStatus.UNASSIGNED,
    },
  });

  return {
    message: "Single unassigned QR tag generated successfully.",
    tag: {
      id: tag.id,
      tagNumber: tag.tagNumber,
      token,
      qrUrl: `${publicAppUrl}/t/${token}`,
      origin: tag.origin,
      status: tag.status,
    },
    resource: null,
  };
};

export interface CreateBatchInput {
  quantity: number;
  origin?: QrTagOrigin | undefined;
  idempotencyKey?: string | undefined;
}

/**
 * Generate a batch of preprinted tags for factory printing (Admin Only).
 * Enforces:
 * 1. Transactional batch creation.
 * 2. Idempotency protection via Redis against duplicate submissions.
 * 3. Unique tag numbers (no ambiguous characters: 0, 1, I, O, L).
 * 4. High-entropy cryptographically random tokens, never derived from tagNumber.
 */
export const createPreprintedBatch = async ({
  quantity,
  origin = QrTagOrigin.PREPRINTED_INVENTORY,
  idempotencyKey,
}: CreateBatchInput) => {
  if (quantity <= 0 || quantity > 5000) {
    throw new BadRequestError("Batch quantity must be between 1 and 5,000.");
  }

  const publicAppUrl = process.env.PUBLIC_APP_URL || "https://pingin.co.in";

  // Check idempotency cache if key provided
  if (idempotencyKey) {
    try {
      const cached = await redis.get(`idempotency:qr_batch:${idempotencyKey}`);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (err) {
      console.warn("Redis idempotency read failed, proceeding with generation:", err);
    }
  }

  const generatedItems: GeneratedTagItem[] = [];
  const tagNumberSet = new Set<string>();

  for (let i = 0; i < quantity; i++) {
    let tagNumber = generateTagNumber();
    while (tagNumberSet.has(tagNumber)) {
      tagNumber = generateTagNumber();
    }
    tagNumberSet.add(tagNumber);

    const token = generateOpaqueToken();
    const tokenHash = hashQrToken(token);

    generatedItems.push({
      tagNumber,
      token,
      tokenHash,
    });
  }

  // Insert into DB inside an atomic transaction
  await prisma.$transaction(async (tx) => {
    await tx.qrTag.createMany({
      data: generatedItems.map((item) => ({
        tagNumber: item.tagNumber,
        tokenHash: item.tokenHash,
        origin,
        status: QrTagStatus.UNASSIGNED,
      })),
      skipDuplicates: true,
    });
  });

  const response = {
    batchId: idempotencyKey ?? `batch_${Date.now()}`,
    count: generatedItems.length,
    origin,
    items: generatedItems.map((item) => ({
      tagNumber: item.tagNumber,
      token: item.token,
      qrUrl: `${publicAppUrl}/t/${item.token}`,
    })),
  };

  // Cache response for 24h if idempotencyKey provided
  if (idempotencyKey) {
    try {
      await redis.set(
        `idempotency:qr_batch:${idempotencyKey}`,
        JSON.stringify(response),
        "EX",
        86400
      );
    } catch (err) {
      console.warn("Redis idempotency write failed:", err);
    }
  }

  return response;
};

/**
 * Retrieve all active QR tags belonging to the authenticated user.
 */
export const getUserTags = async (userId: string) => {
  const tags = await prisma.qrTag.findMany({
    where: {
      resource: {
        userId,
        active: true,
      },
      status: QrTagStatus.ASSIGNED,
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
          contactLink: {
            select: {
              token: true,
            },
          },
        },
      },
    },
    orderBy: {
      assignedAt: "desc",
    },
  });

  return tags.map((tag) => ({
    tagId: tag.id,
    tagNumber: tag.tagNumber,
    status: tag.status,
    origin: tag.origin,
    assignedAt: tag.assignedAt,
    resource: tag.resource
      ? {
          id: tag.resource.id,
          name: tag.resource.name,
          type: tag.resource.type,
          registrationNum: tag.resource.vehicleDetail?.registrationNum ?? null,
          vehicleColour: tag.resource.vehicleDetail?.vehicleColour ?? null,
        }
      : null,
  }));
};
