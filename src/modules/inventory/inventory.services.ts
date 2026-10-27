import { ComponentType, OrderStatus, Prisma, QrTagStockState, ReservationStatus } from "@prisma/client";
import { BadRequestError, NotFoundError } from "../../errors/AppError.js";
import { prisma } from "../../lib/prisma.js";
import type {
  AvailabilityResult,
  CartItemInput,
  CreateReservationInput,
  SkuDemandBreakdown,
} from "./inventory.types.js";
import {
  MAX_RESERVATION_QUANTITY,
  RESERVATION_TTL_MINUTES,
} from "./inventory.types.js";

/**
 * Computes live committed demand for serialized QR tag SKUs.
 *
 * Committed Demand consists of:
 * 1. Paid, unfulfilled orders: status IN ('PAID', 'PACKING')
 *    Calculated per order as: max(0, requiredForSku - alreadyAllocatedForSku)
 *    Explicitly accounts for cancellations/refunds (status NOT IN ('CANCELLED', 'REFUNDED', 'PAYMENT_PENDING')).
 * 2. Active checkout reservations: status = 'ACTIVE' AND expiresAt > NOW()
 *    (Optionally excluding the current checkout session if re-reserving).
 *
 * Formula:
 * Sellable = max(0, Physical in stock - Committed demand)
 */
export const getCommittedDemandBySku = async (options?: {
  excludeCheckoutSessionId?: string | undefined;
  targetSkus?: string[] | undefined;
  tx?: Prisma.TransactionClient | undefined;
}): Promise<Map<string, SkuDemandBreakdown>> => {
  const db = options?.tx || prisma;
  const now = new Date();

  // 1. Paid, unfulfilled orders: status IN ('PAID', 'PACKING')
  const paidOrders = await db.order.findMany({
    where: {
      status: { in: [OrderStatus.PAID, OrderStatus.PACKING] },
    },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      items: {
        select: {
          id: true,
          quantity: true,
          productSnapshot: true,
          variant: {
            select: {
              components: {
                where: { componentType: ComponentType.SERIALIZED_QR_TAG },
                select: { inventorySku: true, quantity: true },
              },
            },
          },
        },
      },
      tagAllocations: {
        select: {
          qrTag: {
            select: {
              inventory: { select: { sku: true } },
            },
          },
        },
      },
    },
  });

  const paidDemandMap = new Map<string, number>();

  for (const order of paidOrders) {
    const orderNeededPerSku = new Map<string, number>();

    for (const item of order.items) {
      const snap = item.productSnapshot as any;
      const comps = snap?.components || item.variant?.components || [];
      for (const comp of comps) {
        if (
          (comp.componentType === ComponentType.SERIALIZED_QR_TAG ||
            comp.componentType === "SERIALIZED_QR_TAG") &&
          comp.inventorySku
        ) {
          const qty = (comp.quantity || 1) * item.quantity;
          orderNeededPerSku.set(
            comp.inventorySku,
            (orderNeededPerSku.get(comp.inventorySku) || 0) + qty
          );
        }
      }
    }

    const orderAllocatedPerSku = new Map<string, number>();
    for (const alloc of order.tagAllocations) {
      const sku = alloc.qrTag?.inventory?.sku;
      if (sku) {
        orderAllocatedPerSku.set(sku, (orderAllocatedPerSku.get(sku) || 0) + 1);
      }
    }

    for (const [sku, needed] of orderNeededPerSku.entries()) {
      const alreadyAllocated = orderAllocatedPerSku.get(sku) || 0;
      const unfulfilled = Math.max(0, needed - alreadyAllocated);
      if (unfulfilled > 0) {
        paidDemandMap.set(sku, (paidDemandMap.get(sku) || 0) + unfulfilled);
      }
    }
  }

  // 2. Active checkout reservations: status = 'ACTIVE' AND expiresAt > now
  const activeReservationsWhere: Prisma.InventoryReservationWhereInput = {
    status: ReservationStatus.ACTIVE,
    expiresAt: { gt: now },
  };

  if (options?.excludeCheckoutSessionId) {
    activeReservationsWhere.checkoutSessionId = { not: options.excludeCheckoutSessionId };
  }

  const activeReservations = await db.inventoryReservation.findMany({
    where: activeReservationsWhere,
    select: {
      id: true,
      items: {
        select: {
          quantity: true,
          variant: {
            select: {
              components: {
                where: { componentType: ComponentType.SERIALIZED_QR_TAG },
                select: { inventorySku: true, quantity: true },
              },
            },
          },
        },
      },
    },
  });

  const reservationDemandMap = new Map<string, number>();
  for (const res of activeReservations) {
    for (const item of res.items) {
      for (const comp of item.variant.components) {
        if (comp.inventorySku) {
          const qty = comp.quantity * item.quantity;
          reservationDemandMap.set(
            comp.inventorySku,
            (reservationDemandMap.get(comp.inventorySku) || 0) + qty
          );
        }
      }
    }
  }

  // Combine into unified demand map
  const allSkus = new Set<string>([
    ...paidDemandMap.keys(),
    ...reservationDemandMap.keys(),
    ...(options?.targetSkus || []),
  ]);

  const result = new Map<string, SkuDemandBreakdown>();
  for (const sku of allSkus) {
    const paidUnfulfilled = paidDemandMap.get(sku) || 0;
    const activeRes = reservationDemandMap.get(sku) || 0;
    result.set(sku, {
      sku,
      paidUnfulfilledDemand: paidUnfulfilled,
      activeReservationsDemand: activeRes,
      totalCommittedDemand: paidUnfulfilled + activeRes,
    });
  }

  return result;
};

export const checkBundleAvailability = async (
  variantId: string,
  quantity: number
): Promise<AvailabilityResult> => {
  if (!Number.isInteger(quantity) || quantity <= 0 || quantity > MAX_RESERVATION_QUANTITY) {
    throw new BadRequestError(`Quantity must be a whole number between 1 and ${MAX_RESERVATION_QUANTITY}`);
  }

  // Auto-release any expired reservations so inventory is made available
  await expireStaleReservations();

  const variant = await prisma.productVariant.findUnique({
    where: { id: variantId, active: true },
    include: { components: true },
  });

  if (!variant) {
    throw new NotFoundError(`Product variant '${variantId}' not found`);
  }

  let requiredTags = 0;
  let totalAvailableTags = 0;
  const shortages: string[] = [];

  const serializedSkuNeeds = new Map<string, number>();
  const physicalItemNeeds = new Map<string, number>();

  for (const comp of variant.components) {
    if (comp.componentType === ComponentType.SERIALIZED_QR_TAG) {
      if (!comp.inventorySku) {
        throw new Error(`Serialized component '${comp.name}' must have inventorySku`);
      }
      const needed = comp.quantity * quantity;
      requiredTags += needed;
      const cur = serializedSkuNeeds.get(comp.inventorySku) || 0;
      serializedSkuNeeds.set(comp.inventorySku, cur + needed);
    } else if (comp.componentType === ComponentType.PHYSICAL_ITEM && comp.inventorySku) {
      const needed = comp.quantity * quantity;
      const cur = physicalItemNeeds.get(comp.inventorySku) || 0;
      physicalItemNeeds.set(comp.inventorySku, cur + needed);
    }
  }

  // Fetch committed demand for the required serialized SKUs
  const demandMap = await getCommittedDemandBySku({
    targetSkus: [...serializedSkuNeeds.keys()],
  });

  // Check each serialized SKU sellable availability: max(0, physical - committed)
  for (const [sku, needed] of serializedSkuNeeds.entries()) {
    const availableResult = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(q.id) as count
      FROM "QrTag" q
      JOIN "QrTagInventory" qi ON qi."qrTagId" = q.id
      WHERE q.status = 'UNASSIGNED'
        AND q.origin = 'PREPRINTED_INVENTORY'
        AND qi.sku = ${sku}
        AND qi.state = 'IN_STOCK';
    `;
    const physical = Number(availableResult[0]?.count ?? 0);
    const committed = demandMap.get(sku)?.totalCommittedDemand || 0;
    const sellable = Math.max(0, physical - committed);

    totalAvailableTags += sellable;
    if (sellable < needed) {
      shortages.push(
        `QR Tag SKU ${sku}: required ${needed}, sellable ${sellable} (physical in stock: ${physical}, committed: ${committed})`
      );
    }
  }

  // Check bulk physical items
  for (const [sku, needed] of physicalItemNeeds.entries()) {
    const stock = await prisma.inventoryStock.findUnique({
      where: { sku },
    });
    const onHand = stock ? stock.quantityOnHand - stock.reservedCount : 0;
    if (onHand < needed) {
      shortages.push(`Item SKU ${sku}: required ${needed}, available ${onHand}`);
    }
  }

  return {
    available: shortages.length === 0,
    requiredTags,
    availableTags: totalAvailableTags,
    shortages,
  };
};

export const createAtomicReservation = async (input: CreateReservationInput) => {
  const { checkoutSessionId, userId } = input;
  if (!checkoutSessionId) {
    throw new BadRequestError("checkoutSessionId is required");
  }

  // 1. Normalize items list (supports multi-item cart or single variantId/quantity)
  let cartItems: CartItemInput[] = [];

  if (input.items && Array.isArray(input.items) && input.items.length > 0) {
    cartItems = input.items.map((i) => ({
      variantId: i.variantId,
      quantity: Number(i.quantity),
    }));
  } else if (input.variantId && input.quantity) {
    cartItems = [{ variantId: input.variantId, quantity: Number(input.quantity) }];
  } else {
    throw new BadRequestError("Must provide either 'items' array or 'variantId' and 'quantity'");
  }

  // Deduplicate / consolidate same variantIds
  const consolidatedMap = new Map<string, number>();
  for (const item of cartItems) {
    if (!item.variantId) {
      throw new BadRequestError("Each cart item must have a valid variantId");
    }
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      throw new BadRequestError(`Invalid quantity for variant ${item.variantId}. Must be a positive integer.`);
    }
    const cur = consolidatedMap.get(item.variantId) || 0;
    consolidatedMap.set(item.variantId, cur + item.quantity);
  }

  const normalizedItems: CartItemInput[] = [];
  let totalCartQuantity = 0;
  for (const [variantId, quantity] of consolidatedMap.entries()) {
    totalCartQuantity += quantity;
    normalizedItems.push({ variantId, quantity });
  }

  if (totalCartQuantity > MAX_RESERVATION_QUANTITY) {
    throw new BadRequestError(`Total cart quantity cannot exceed ${MAX_RESERVATION_QUANTITY} items`);
  }

  // Auto-release any expired reservations so inventory is made available
  await expireStaleReservations();

  const now = new Date();
  const expiresAt = new Date(now.getTime() + RESERVATION_TTL_MINUTES * 60 * 1000);

  return await prisma.$transaction(async (tx) => {
    // 2. Lock all requested variant rows in sorted order to prevent deadlocks
    const sortedVariantIds = normalizedItems.map((i) => i.variantId).sort((a, b) => a.localeCompare(b));
    for (const vId of sortedVariantIds) {
      await tx.$queryRaw`
        SELECT id FROM "ProductVariant"
        WHERE id = ${vId}::uuid
        FOR UPDATE
      `;
    }

    const variants = await tx.productVariant.findMany({
      where: { id: { in: sortedVariantIds }, active: true },
      include: { components: true },
    });

    if (variants.length !== sortedVariantIds.length) {
      throw new NotFoundError("One or more product variants in cart were not found or are inactive");
    }

    const variantMap = new Map(variants.map((v) => [v.id, v]));

    // 3. Aggregate physical component requirements across all variants in cart
    const serializedRequirements = new Map<string, number>();
    const physicalItemDeltas = new Map<string, number>();

    for (const item of normalizedItems) {
      const variant = variantMap.get(item.variantId)!;
      for (const comp of variant.components) {
        if (comp.quantity <= 0) {
          throw new Error(`Invalid component quantity for ${comp.id}`);
        }
        const needed = comp.quantity * item.quantity;
        if (comp.componentType === ComponentType.SERIALIZED_QR_TAG) {
          if (!comp.inventorySku) {
            throw new Error(`Serialized tag component ${comp.id} must define inventorySku`);
          }
          const cur = serializedRequirements.get(comp.inventorySku) || 0;
          serializedRequirements.set(comp.inventorySku, cur + needed);
        } else if (comp.componentType === ComponentType.PHYSICAL_ITEM) {
          if (!comp.inventorySku) {
            throw new Error(`Physical component ${comp.id} must define inventorySku`);
          }
          const cur = physicalItemDeltas.get(comp.inventorySku) || 0;
          physicalItemDeltas.set(comp.inventorySku, cur + needed);
        }
      }
    }

    // 4. Atomically verify serialized tag SKU quantities are available in warehouse pool
    const sortedSerializedSkus = [...serializedRequirements.entries()].sort(([a], [b]) =>
      a.localeCompare(b)
    );

    // Acquire PostgreSQL transaction-level advisory locks in deterministic alphabetical order
    // to strictly serialize concurrent checkout attempts on the same physical SKU pool
    for (const [sku] of sortedSerializedSkus) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${sku}))`;
    }

    // With atomic locks held, calculate committed demand (excluding current session if re-reserving)
    const demandMap = await getCommittedDemandBySku({
      tx,
      excludeCheckoutSessionId: checkoutSessionId,
      targetSkus: sortedSerializedSkus.map(([sku]) => sku),
    });

    for (const [sku, totalNeededForSku] of sortedSerializedSkus) {
      const physicalResult = await tx.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(q.id) as count
        FROM "QrTag" q
        JOIN "QrTagInventory" qi ON qi."qrTagId" = q.id
        WHERE q.status = 'UNASSIGNED'
          AND q.origin = 'PREPRINTED_INVENTORY'
          AND qi.sku = ${sku}
          AND qi.state = 'IN_STOCK';
      `;
      const physical = Number(physicalResult[0]?.count ?? 0);
      const committed = demandMap.get(sku)?.totalCommittedDemand || 0;
      const sellable = Math.max(0, physical - committed);

      if (sellable < totalNeededForSku) {
        throw new BadRequestError(
          `Insufficient QR tag stock for SKU ${sku}. Required: ${totalNeededForSku}, Sellable: ${sellable} (Physical in stock: ${physical}, Committed demand: ${committed})`
        );
      }
    }

    // 5. Reserve bulk stock with conditional atomic updates
    const sortedBulkSkus = [...physicalItemDeltas.entries()].sort(([a], [b]) =>
      a.localeCompare(b)
    );

    for (const [sku, count] of sortedBulkSkus) {
      const updated = await tx.$executeRaw`
        UPDATE "InventoryStock"
        SET "reservedCount" = "reservedCount" + ${count}, "updatedAt" = NOW()
        WHERE sku = ${sku}
          AND "quantityOnHand" - "reservedCount" >= ${count}
      `;
      if (updated !== 1) {
        throw new BadRequestError(`Insufficient stock for component SKU ${sku}`);
      }
    }

    // 6. Create or update InventoryReservation record with all items
    const reservation = await tx.inventoryReservation.upsert({
      where: { checkoutSessionId },
      update: {
        userId: userId ?? null,
        status: ReservationStatus.ACTIVE,
        expiresAt,
        releasedAt: null,
        committedAt: null,
        items: {
          deleteMany: {},
          create: normalizedItems.map((item) => ({
            variantId: item.variantId,
            quantity: item.quantity,
          })),
        },
      },
      create: {
        checkoutSessionId,
        userId: userId ?? null,
        status: ReservationStatus.ACTIVE,
        expiresAt,
        items: {
          create: normalizedItems.map((item) => ({
            variantId: item.variantId,
            quantity: item.quantity,
          })),
        },
      },
      include: {
        items: {
          include: {
            variant: {
              select: {
                id: true,
                name: true,
                price: true,
                sku: true,
              },
            },
          },
        },
      },
    });

    return reservation;
  });
};

export const releaseReservation = async (reservationId: string) => {
  return await prisma.$transaction(async (tx) => {
    const reservation = await tx.inventoryReservation.findUnique({
      where: { id: reservationId },
      include: {
        items: {
          include: {
            allocatedTags: true,
            variant: { include: { components: true } },
          },
        },
      },
    });

    if (!reservation) {
      throw new NotFoundError("Reservation not found");
    }

    if (reservation.status !== ReservationStatus.ACTIVE) {
      return reservation;
    }

    // Release bulk physical items
    for (const item of reservation.items) {
      for (const comp of item.variant.components) {
        if (comp.componentType === ComponentType.PHYSICAL_ITEM && comp.inventorySku) {
          const needed = comp.quantity * item.quantity;
          await tx.$executeRaw`
            UPDATE "InventoryStock"
            SET "reservedCount" = GREATEST("reservedCount" - ${needed}, 0),
                "updatedAt" = NOW()
            WHERE sku = ${comp.inventorySku}
          `;
        }
      }
    }

    // Restore QrTagInventory state back to IN_STOCK
    await tx.qrTagInventory.updateMany({
      where: { activeReservationId: reservation.id },
      data: {
        state: QrTagStockState.IN_STOCK,
        activeReservationId: null,
      },
    });

    // Remove ReservedTag audit rows
    await tx.reservedTag.deleteMany({
      where: {
        reservationItemId: {
          in: reservation.items.map((i) => i.id),
        },
      },
    });

    // Mark reservation RELEASED
    return await tx.inventoryReservation.update({
      where: { id: reservationId },
      data: {
        status: ReservationStatus.RELEASED,
        releasedAt: new Date(),
      },
    });
  });
};

export const getReservationBySessionId = async (checkoutSessionId: string) => {
  const reservation = await prisma.inventoryReservation.findUnique({
    where: { checkoutSessionId },
    include: {
      items: {
        include: {
          allocatedTags: {
            include: {
              qrTag: {
                select: {
                  id: true,
                  tagNumber: true,
                  status: true,
                },
              },
              component: {
                select: {
                  id: true,
                  name: true,
                  inventorySku: true,
                },
              },
            },
          },
          variant: {
            include: {
              product: true,
              components: true,
            },
          },
        },
      },
    },
  });

  if (!reservation) {
    throw new NotFoundError(`Reservation with session '${checkoutSessionId}' not found`);
  }

  // Auto-expire check
  if (reservation.status === ReservationStatus.ACTIVE && reservation.expiresAt < new Date()) {
    await releaseReservation(reservation.id);
    return {
      ...reservation,
      status: ReservationStatus.EXPIRED,
    };
  }

  return reservation;
};

export const expireStaleReservations = async (): Promise<number> => {
  const now = new Date();
  const staleReservations = await prisma.inventoryReservation.findMany({
    where: {
      status: ReservationStatus.ACTIVE,
      expiresAt: { lt: now },
    },
  });

  for (const res of staleReservations) {
    try {
      await releaseReservation(res.id);
      await prisma.inventoryReservation.update({
        where: { id: res.id },
        data: { status: ReservationStatus.EXPIRED },
      });
    } catch (err) {
      console.error(`Failed to expire reservation ${res.id}:`, err);
    }
  }

  return staleReservations.length;
};
