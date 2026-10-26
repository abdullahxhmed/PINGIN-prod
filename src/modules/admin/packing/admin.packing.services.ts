import {
  OrderStatus,
  OutboxStatus,
  PackingSessionStatus,
  QrTagStatus,
  QrTagStockState,
} from "@prisma/client";
import { BadRequestError, ConflictError, NotFoundError } from "../../../errors/AppError.js";
import { prisma } from "../../../lib/prisma.js";
import { hashQrToken } from "../../qr/qr.services.js";
import { resolveImageUrl } from "../../catalog/catalog-images.service.js";
import type {
  PackingProgressSummary,
  ScanTagResult,
  SkuRequirementProgress,
} from "./admin.packing.types.js";

interface OrderSnapshotComponent {
  id?: string;
  name: string;
  quantity: number;
  inventorySku?: string | null;
  componentType: string;
  plusDurationMonths?: number;
}

interface OrderSnapshot {
  product?: {
    id: string;
    sku: string;
    name: string;
    imageUrl?: string | null;
  };
  variant?: {
    id: string;
    sku: string;
    name: string;
    price: number;
  };
  components?: OrderSnapshotComponent[];
}

/**
 * Calculates total required serialized tags per SKU from the immutable order item snapshots.
 */
const getOrderSerializedRequirements = (
  items: Array<{ id: string; quantity: number; productSnapshot: any }>
): Map<string, { sku: string; name: string; totalNeeded: number; orderItemId: string; imageReference: string | null }> => {
  const reqs = new Map<string, { sku: string; name: string; totalNeeded: number; orderItemId: string; imageReference: string | null }>();

  for (const item of items) {
    const snap = item.productSnapshot as OrderSnapshot;
    const ref = snap?.product?.imageUrl ?? null;
    for (const comp of snap?.components || []) {
      if (comp.componentType === "SERIALIZED_QR_TAG" && comp.inventorySku) {
        const sku = comp.inventorySku;
        const needed = comp.quantity * item.quantity;
        const existing = reqs.get(sku);
        if (existing) {
          existing.totalNeeded += needed;
        } else {
          reqs.set(sku, {
            sku,
            name: comp.name,
            totalNeeded: needed,
            orderItemId: item.id,
            imageReference: ref,
          });
        }
      }
    }
  }

  return reqs;
};

/**
 * Computes live packing progress summary for an order.
 */
export const adminGetPackingSessionStatus = async (
  orderId: string
): Promise<PackingProgressSummary> => {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      items: true,
      tagAllocations: {
        include: {
          qrTag: {
            include: { inventory: true },
          },
        },
      },
      packingSessions: {
        orderBy: { sessionNumber: "desc" },
        include: {
          scans: {
            orderBy: { scannedAt: "asc" },
            include: {
              qrTag: {
                include: { inventory: true },
              },
            },
          },
        },
      },
    },
  });

  if (!order) {
    throw new NotFoundError(`Order '${orderId}' not found`);
  }

  const activeSession = order.packingSessions.find(
    (s) => s.status === PackingSessionStatus.IN_PROGRESS
  );
  const latestSession = activeSession || order.packingSessions[0] || null;

  const requirements = getOrderSerializedRequirements(order.items);
  const skuProgress: SkuRequirementProgress[] = [];

  let totalRequired = 0;
  let totalScanned = 0;

  for (const req of requirements.values()) {
    totalRequired += req.totalNeeded;
    const scannedForSku = order.tagAllocations.filter(
      (a) => a.qrTag.inventory?.sku === req.sku
    ).length;

    totalScanned += scannedForSku;
    const resolvedImage = await resolveImageUrl(req.imageReference);

    skuProgress.push({
      sku: req.sku,
      name: req.name,
      required: req.totalNeeded,
      scanned: scannedForSku,
      remaining: Math.max(0, req.totalNeeded - scannedForSku),
      imageUrl: resolvedImage?.url ?? req.imageReference ?? null,
      imageReference: req.imageReference ?? null,
    });
  }

  const scannedTags = order.tagAllocations.map((a) => ({
    tagNumber: a.qrTag.tagNumber,
    sku: a.qrTag.inventory?.sku || "UNKNOWN",
    scannedAt: a.createdAt,
    orderItemId: requirements.get(a.qrTag.inventory?.sku || "")?.orderItemId || "",
  }));

  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    orderStatus: order.status,
    activeSessionId: activeSession ? activeSession.id : null,
    sessionStatus: latestSession ? latestSession.status : null,
    sessionNumber: latestSession ? latestSession.sessionNumber : null,
    packedBy: latestSession ? latestSession.packedBy : null,
    totalRequired,
    totalScanned,
    isComplete: totalRequired > 0 && totalScanned >= totalRequired,
    skuProgress,
    scannedTags,
  };
};

/**
 * Starts a new warehouse packing session.
 * Enforces exactly one IN_PROGRESS session using order row locking.
 */
export const adminStartPackingSession = async (
  orderId: string,
  packedBy?: string
) => {
  return await prisma.$transaction(async (tx) => {
    // 1. Lock the order row exclusively
    const [order] = await tx.$queryRaw<Array<{ id: string; status: OrderStatus; orderNumber: string }>>`
      SELECT id, status, "orderNumber" 
      FROM "Order" 
      WHERE id = ${orderId}::uuid 
      FOR UPDATE;
    `;

    if (!order) {
      throw new NotFoundError(`Order '${orderId}' not found`);
    }

    if (order.status !== OrderStatus.PAID && order.status !== OrderStatus.PACKING) {
      throw new ConflictError(
        `Order '${order.orderNumber}' is not eligible for packing (current status: ${order.status}). Must be PAID or PACKING.`
      );
    }

    // 2. Verify no active session exists
    const existingActive = await tx.packingSession.findFirst({
      where: { orderId, status: PackingSessionStatus.IN_PROGRESS },
    });

    if (existingActive) {
      return existingActive; // Idempotently return currently active session
    }

    // 3. Determine next session number
    const lastSession = await tx.packingSession.findFirst({
      where: { orderId },
      orderBy: { sessionNumber: "desc" },
    });
    const nextSessionNumber = (lastSession?.sessionNumber ?? 0) + 1;

    // 4. Update order status to PACKING
    if (order.status !== OrderStatus.PACKING) {
      await tx.order.update({
        where: { id: orderId },
        data: { status: OrderStatus.PACKING },
      });
    }

    // 5. Create new session
    return await tx.packingSession.create({
      data: {
        orderId,
        sessionNumber: nextSessionNumber,
        status: PackingSessionStatus.IN_PROGRESS,
        packedBy: packedBy ?? "warehouse_operator",
      },
    });
  });
};

/**
 * Scans a physical QR tag during an active packing session.
 * Enforces atomic inventory state transition, SKU match, and authoritative allocation.
 */
export const adminScanPackingTag = async (
  orderId: string,
  sessionId: string,
  scannedCode: string
): Promise<ScanTagResult> => {
  const cleanCode = scannedCode.trim();
  if (!cleanCode) {
    throw new BadRequestError("Scanned tag code/token is required");
  }

  const scanResult = await prisma.$transaction(async (tx) => {
    // 1. Lock and validate session
    const session = await tx.packingSession.findUnique({
      where: { id: sessionId },
      include: {
        order: {
          include: {
            items: true,
            tagAllocations: {
              include: { qrTag: { include: { inventory: true } } },
            },
          },
        },
      },
    });

    if (!session || session.orderId !== orderId) {
      throw new NotFoundError("Packing session not found for this order");
    }

    if (session.status !== PackingSessionStatus.IN_PROGRESS) {
      throw new ConflictError(`Packing session is ${session.status}. Only IN_PROGRESS sessions accept scans.`);
    }

    if (session.order.status !== OrderStatus.PACKING) {
      throw new ConflictError(`Order status is ${session.order.status}. Must be PACKING.`);
    }

    // 2. Resolve the scanned tag (support raw tagNumber e.g. "JZV37NP" or token)
    const tokenHash = hashQrToken(cleanCode);
    const tag = await tx.qrTag.findFirst({
      where: {
        OR: [{ tagNumber: cleanCode }, { tokenHash }],
      },
      select: { id: true, tagNumber: true, status: true },
    });

    if (!tag) {
      throw new NotFoundError(`Physical tag '${cleanCode}' is not registered in the system.`);
    }

    // 3. Operational check: tag must be UNASSIGNED to a customer vehicle
    if (tag.status !== QrTagStatus.UNASSIGNED) {
      throw new ConflictError(`Tag '${tag.tagNumber}' operational status is ${tag.status}; cannot allocate.`);
    }

    // 4. Check idempotency: already scanned in this session?
    const alreadyInSession = await tx.packingScan.findUnique({
      where: {
        packingSessionId_qrTagId: {
          packingSessionId: sessionId,
          qrTagId: tag.id,
        },
      },
    });

    if (alreadyInSession) {
      return {
        alreadyScanned: true,
        scannedTagNumber: tag.tagNumber,
        sku: "ALREADY_SCANNED",
        orderItemId: alreadyInSession.orderItemId,
      };
    }

    // 5. Lock specifically the QrTagInventory row with FOR UPDATE
    const [inv] = await tx.$queryRaw<Array<{ id: string; sku: string; state: string }>>`
      SELECT id, sku, state 
      FROM "QrTagInventory" 
      WHERE "qrTagId" = ${tag.id}::uuid 
      FOR UPDATE;
    `;

    if (!inv) {
      throw new NotFoundError(`Tag '${tag.tagNumber}' has no inventory tracking record.`);
    }

    if (inv.state !== QrTagStockState.IN_STOCK) {
      throw new ConflictError(
        `Tag '${tag.tagNumber}' is currently ${inv.state}; expected IN_STOCK.`
      );
    }

    // 6. Validate SKU against order requirements
    const requirements = getOrderSerializedRequirements(session.order.items);
    const req = requirements.get(inv.sku);

    if (!req) {
      throw new BadRequestError(
        `Scanned tag SKU '${inv.sku}' (Tag: ${tag.tagNumber}) is not required for this order.`
      );
    }

    const alreadyAllocatedCount = session.order.tagAllocations.filter(
      (a) => a.qrTag.inventory?.sku === inv.sku
    ).length;

    if (alreadyAllocatedCount >= req.totalNeeded) {
      throw new ConflictError(
        `Order already has all ${req.totalNeeded} required items for SKU '${inv.sku}'.`
      );
    }

    // 7. Atomic state transitions:
    // a. Transition physical tag inventory to ALLOCATED_TO_ORDER
    await tx.qrTagInventory.update({
      where: { qrTagId: tag.id },
      data: { state: QrTagStockState.ALLOCATED_TO_ORDER },
    });

    // b. Authoritative allocation record (qrTagId @unique enforces global uniqueness)
    await tx.orderTagAllocation.create({
      data: {
        orderId,
        qrTagId: tag.id,
      },
    });

    // c. Append-only audit record
    await tx.packingScan.create({
      data: {
        packingSessionId: session.id,
        orderItemId: req.orderItemId,
        qrTagId: tag.id,
        scannedTagNumber: tag.tagNumber,
      },
    });

    return {
      alreadyScanned: false,
      scannedTagNumber: tag.tagNumber,
      sku: inv.sku,
      orderItemId: req.orderItemId,
    };
  });

  // 8. Return fresh progress summary AFTER transaction commit
  const summary = await adminGetPackingSessionStatus(orderId);
  return {
    success: true,
    alreadyScanned: scanResult.alreadyScanned,
    scannedTagNumber: scanResult.scannedTagNumber,
    sku: scanResult.sku,
    orderItemId: scanResult.orderItemId,
    progress: summary,
  };
};

/**
 * Cancels an active packing session.
 * Atomically rolls back inventory state to IN_STOCK, deletes tentative allocations,
 * and preserves PackingScan rows as permanent audit records.
 */
export const adminCancelPackingSession = async (
  orderId: string,
  sessionId: string,
  reason?: string
) => {
  return await prisma.$transaction(async (tx) => {
    const session = await tx.packingSession.findUnique({
      where: { id: sessionId },
      include: {
        scans: true,
      },
    });

    if (!session || session.orderId !== orderId) {
      throw new NotFoundError("Packing session not found for this order");
    }

    if (session.status !== PackingSessionStatus.IN_PROGRESS) {
      throw new BadRequestError(`Cannot cancel session with status ${session.status}`);
    }

    const tagIds = session.scans.map((s) => s.qrTagId);

    if (tagIds.length > 0) {
      // 1. Roll back physical inventory state to IN_STOCK
      await tx.qrTagInventory.updateMany({
        where: {
          qrTagId: { in: tagIds },
          state: QrTagStockState.ALLOCATED_TO_ORDER,
        },
        data: { state: QrTagStockState.IN_STOCK },
      });

      // 2. Remove authoritative allocations for these tags
      await tx.orderTagAllocation.deleteMany({
        where: {
          orderId,
          qrTagId: { in: tagIds },
        },
      });
    }

    // 3. Mark session CANCELLED (PackingScan rows are preserved forever for audit)
    await tx.packingSession.update({
      where: { id: sessionId },
      data: {
        status: PackingSessionStatus.CANCELLED,
        completedAt: new Date(),
      },
    });

    // 4. Revert order status to PAID
    await tx.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.PAID },
    });

    return {
      success: true,
      sessionId,
      releasedTagCount: tagIds.length,
      reason: reason ?? "Cancelled by operator",
    };
  });
};

/**
 * Finalizes packing session and manifest.
 * Validates 100% item completion, marks Order PACKED, and enqueues shipment outbox job.
 */
export const adminFinalizePackingSession = async (
  orderId: string,
  sessionId: string
) => {
  return await prisma.$transaction(async (tx) => {
    const session = await tx.packingSession.findUnique({
      where: { id: sessionId },
      include: {
        order: {
          include: {
            items: true,
            tagAllocations: {
              include: { qrTag: { include: { inventory: true } } },
            },
          },
        },
      },
    });

    if (!session || session.orderId !== orderId) {
      throw new NotFoundError("Packing session not found for this order");
    }

    if (session.status !== PackingSessionStatus.IN_PROGRESS) {
      throw new BadRequestError(`Packing session is ${session.status}; cannot finalize.`);
    }

    // Verify all required serialized SKUs are completely packed
    const requirements = getOrderSerializedRequirements(session.order.items);
    for (const req of requirements.values()) {
      const allocated = session.order.tagAllocations.filter(
        (a) => a.qrTag.inventory?.sku === req.sku
      ).length;

      if (allocated < req.totalNeeded) {
        throw new BadRequestError(
          `Cannot finalize packing: SKU '${req.sku}' requires ${req.totalNeeded} units, but only ${allocated} were scanned.`
        );
      }
    }

    const now = new Date();

    // 1. Mark session COMPLETED
    const completedSession = await tx.packingSession.update({
      where: { id: sessionId },
      data: {
        status: PackingSessionStatus.COMPLETED,
        completedAt: now,
      },
    });

    // 2. Mark order PACKED
    await tx.order.update({
      where: { id: orderId },
      data: {
        status: OrderStatus.PACKED,
        updatedAt: now,
      },
    });

    // 3. Enqueue DISPATCH_SHIPMENT OutboxJob for Shiprocket worker
    await tx.outboxJob.upsert({
      where: { dedupeKey: `order:${orderId}:dispatch` },
      create: {
        type: "DISPATCH_SHIPMENT",
        dedupeKey: `order:${orderId}:dispatch`,
        payload: {
          orderId,
          orderNumber: session.order.orderNumber,
          allocatedTagCount: session.order.tagAllocations.length,
          packedAt: now.toISOString(),
        },
        status: OutboxStatus.PENDING,
      },
      update: {},
    });

    return {
      success: true,
      orderId,
      orderNumber: session.order.orderNumber,
      orderStatus: OrderStatus.PACKED,
      session: completedSession,
      allocatedTagsCount: session.order.tagAllocations.length,
    };
  });
};
