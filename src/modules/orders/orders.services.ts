import crypto from "node:crypto";
import { Prisma, OrderStatus, ReservationStatus, GrantStatus, PaymentStatus, OutboxStatus, QrTagStockState } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { BadRequestError, ConflictError, NotFoundError } from "../../errors/AppError.js";
import { razorpayClient } from "../../integrations/razorpay/razorpay.client.js";
import { shiprocketClient } from "../../integrations/shiprocket/shiprocket.client.js";
import { resolveOrderImages } from "../catalog/catalog-images.service.js";
import type { CheckoutOrderInput, CheckoutResult, ReconcilePaymentInput } from "./orders.types.js";

/**
 * Generates a memorable, non-collidable order number in the format KT024958.
 * Format: 'KT' + 6 zero-padded random digits (1,000,000 space) with collision check.
 */
export const generateOrderNumber = async (tx?: Prisma.TransactionClient): Promise<string> => {
  const client = tx || prisma;
  for (let attempt = 0; attempt < 10; attempt++) {
    const digits = crypto.randomInt(0, 1000000).toString().padStart(6, "0");
    const candidate = `KT${digits}`;
    const exists = await client.order.findUnique({
      where: { orderNumber: candidate },
      select: { id: true },
    });
    if (!exists) {
      return candidate;
    }
  }
  // Fallback if 6-digit space is crowded
  const digits = crypto.randomInt(0, 1000000).toString().padStart(6, "0");
  const suffix = crypto.randomBytes(1).toString("hex").toUpperCase();
  return `KT${digits}${suffix}`;
};

/**
 * Extracts total Plus subscription duration in months from an order's immutable product snapshots.
 */
export const calculatePlusDurationFromOrder = (order: {
  items: Array<{ productSnapshot: any; quantity: number }>;
}): number => {
  let totalMonths = 0;
  for (const item of order.items) {
    const snapshot = item.productSnapshot as any;
    const components = snapshot?.components || [];
    for (const comp of components) {
      if (comp.plusDurationMonths && comp.plusDurationMonths > 0) {
        totalMonths += comp.plusDurationMonths * item.quantity;
      }
    }
  }
  return totalMonths;
};

/**
 * Creates a guest-capable local order linked to an active inventory reservation,
 * then synchronously creates a Razorpay order.
 */
export const createOrderFromCheckout = async (
  input: CheckoutOrderInput,
  authenticatedUserId?: string | undefined
): Promise<CheckoutResult> => {
  // 1. Client-supplied idempotency check
  if (input.checkoutIdempotencyKey) {
    const existingOrder = await prisma.order.findUnique({
      where: { checkoutIdempotencyKey: input.checkoutIdempotencyKey },
      include: {
        items: true,
        payments: true,
      },
    });

    if (existingOrder && existingOrder.razorpayOrderId) {
      return {
        orderNumber: existingOrder.orderNumber,
        orderId: existingOrder.id,
        status: existingOrder.status,
        amount: existingOrder.totalAmount,
        currency: existingOrder.currency,
        razorpayOrderId: existingOrder.razorpayOrderId,
        keyId: razorpayClient.getKeyId(),
        customerEmail: existingOrder.customerEmail ?? undefined,
        customerPhone: existingOrder.customerPhone ?? undefined,
        items: existingOrder.items.map((i) => {
          const snap = i.productSnapshot as any;
          return {
            variantName: snap?.variant?.name || "Product Variant",
            quantity: i.quantity,
            unitPrice: i.unitPrice,
            totalPrice: i.totalPrice,
          };
        }),
      };
    }
  }

  // 2. Fetch and validate the inventory reservation
  const reservation = await prisma.inventoryReservation.findUnique({
    where: { checkoutSessionId: input.checkoutSessionId },
    include: {
      order: true,
      items: {
        include: {
          variant: {
            include: { product: true, components: true },
          },
        },
      },
    },
  });

  if (!reservation) {
    throw new NotFoundError("Checkout reservation not found. Please reserve items before checking out.");
  }

  if (reservation.status !== ReservationStatus.ACTIVE) {
    throw new BadRequestError(
      `Checkout reservation is no longer active (status: ${reservation.status}). Please reserve items again.`
    );
  }

  if (reservation.expiresAt < new Date()) {
    throw new BadRequestError("Checkout reservation has expired. Please reserve items again.");
  }

  if (reservation.order) {
    if (reservation.order.razorpayOrderId) {
      return {
        orderNumber: reservation.order.orderNumber,
        orderId: reservation.order.id,
        status: reservation.order.status,
        amount: reservation.order.totalAmount,
        currency: reservation.order.currency,
        razorpayOrderId: reservation.order.razorpayOrderId,
        keyId: razorpayClient.getKeyId(),
        customerEmail: reservation.order.customerEmail ?? undefined,
        customerPhone: reservation.order.customerPhone ?? undefined,
        items: reservation.items.map((i) => ({
          variantName: i.variant.name,
          quantity: i.quantity,
          unitPrice: i.variant.price,
          totalPrice: i.variant.price * i.quantity,
        })),
      };
    }
  }

  // 3. Compute price totals and immutable snapshots from server-verified variants
  let subtotalAmount = 0;
  const orderItemsData = reservation.items.map((item) => {
    const unitPrice = item.variant.price;
    const totalPrice = unitPrice * item.quantity;
    subtotalAmount += totalPrice;

    const productSnapshot = {
      product: {
        id: item.variant.product.id,
        sku: item.variant.product.sku,
        name: item.variant.product.name,
        slug: item.variant.product.slug,
        type: item.variant.product.type,
        imageUrl: item.variant.product.imageUrl,
        weightGrams: item.variant.product.weightGrams,
        lengthCm: item.variant.product.lengthCm,
        breadthCm: item.variant.product.breadthCm,
        heightCm: item.variant.product.heightCm,
      },
      variant: {
        id: item.variant.id,
        sku: item.variant.sku,
        name: item.variant.name,
        price: item.variant.price,
        imageUrl: item.variant.imageUrl || item.variant.product.imageUrl || null,
      },
      components: item.variant.components.map((c) => ({
        id: c.id,
        componentType: c.componentType,
        name: c.name,
        quantity: c.quantity,
        plusDurationMonths: c.plusDurationMonths,
        inventorySku: c.inventorySku,
      })),
    };

    return {
      variantId: item.variantId,
      quantity: item.quantity,
      unitPrice,
      totalPrice,
      productSnapshot,
    };
  });

  const taxAmount = 0;
  const shippingAmount = 0;
  const totalAmount = subtotalAmount + taxAmount + shippingAmount;

  if (totalAmount <= 0) {
    throw new BadRequestError("Order total amount must be greater than zero.");
  }

  const userId = authenticatedUserId ?? reservation.userId ?? null;

  // 4. Create Order & Shipping Address in a single atomic transaction
  const createdOrder = await prisma.$transaction(async (tx) => {
    const orderNumber = await generateOrderNumber(tx);
    const order = await tx.order.create({
      data: {
        orderNumber,
        userId,
        customerEmail: input.customerEmail?.toLowerCase() ?? null,
        customerPhone: input.customerPhone ?? null,
        reservationId: reservation.id,
        status: OrderStatus.PAYMENT_PENDING,
        subtotalAmount,
        taxAmount,
        shippingAmount,
        totalAmount,
        currency: "INR",
        checkoutIdempotencyKey: input.checkoutIdempotencyKey ?? null,
        shippingAddress: {
          create: {
            fullName: input.shippingAddress.fullName,
            phoneNumber: input.shippingAddress.phoneNumber,
            addressLine1: input.shippingAddress.addressLine1,
            addressLine2: input.shippingAddress.addressLine2 ?? null,
            city: input.shippingAddress.city,
            state: input.shippingAddress.state,
            postalCode: input.shippingAddress.postalCode,
            country: input.shippingAddress.country || "IN",
          },
        },
        items: {
          create: orderItemsData,
        },
      },
      include: {
        items: true,
      },
    });

    await tx.inventoryReservation.update({
      where: { id: reservation.id },
      data: { orderId: order.id },
    });

    return order;
  });

  // 5. Synchronously call Razorpay Orders API outside DB transaction
  let razorpayOrder;
  try {
    razorpayOrder = await razorpayClient.createOrder({
      amount: totalAmount,
      currency: "INR",
      receipt: createdOrder.orderNumber,
      notes: {
        orderId: createdOrder.id,
        orderNumber: createdOrder.orderNumber,
      },
    });
  } catch (err: any) {
    // If Razorpay API call fails, leave order in PAYMENT_PENDING so user can retry or reconcile
    throw new BadRequestError(`Failed to initiate payment gateway: ${err.message}`);
  }

  // 6. Record Razorpay Order ID on local order and initialize PaymentTransaction
  await prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: createdOrder.id },
      data: { razorpayOrderId: razorpayOrder.id },
    });

    await tx.paymentTransaction.create({
      data: {
        orderId: createdOrder.id,
        provider: "RAZORPAY",
        status: PaymentStatus.PENDING,
        amount: totalAmount,
        currency: "INR",
        razorpayOrderId: razorpayOrder.id,
      },
    });
  });

  return {
    orderNumber: createdOrder.orderNumber,
    orderId: createdOrder.id,
    status: createdOrder.status,
    amount: totalAmount,
    currency: "INR",
    razorpayOrderId: razorpayOrder.id,
    keyId: razorpayClient.getKeyId(),
    customerEmail: input.customerEmail ?? undefined,
    customerPhone: input.customerPhone ?? undefined,
    items: reservation.items.map((i) => ({
      variantName: i.variant.name,
      quantity: i.quantity,
      unitPrice: i.variant.price,
      totalPrice: i.variant.price * i.quantity,
    })),
  };
};

/**
 * Reconciles a captured payment idempotently in a single PostgreSQL transaction.
 * Commits reservation, transitions inventory states, decrements bulk stock,
 * creates OrderTagAllocation, creates SubscriptionGrant, and enqueues FULFILL_ORDER OutboxJob.
 */
export const reconcileCapturedPayment = async (input: ReconcilePaymentInput): Promise<void> => {
  const { providerOrderId, providerPaymentId, amount, currency = "INR", rawPayload } = input;

  // Resolve local order through the stored razorpayOrderId
  const order = await prisma.order.findUnique({
    where: { razorpayOrderId: providerOrderId },
    include: {
      items: true,
      reservation: {
        include: {
          items: {
            include: {
              allocatedTags: true,
              variant: { include: { components: true } },
            },
          },
        },
      },
      payments: true,
    },
  });

  if (!order) {
    throw new NotFoundError(`No local order found matching Razorpay Order ID ${providerOrderId}`);
  }

  // Verify amount and currency
  if (amount !== order.totalAmount) {
    throw new Error(
      `Payment amount mismatch for order ${order.orderNumber}: expected ${order.totalAmount}, received ${amount}`
    );
  }

  if (currency !== order.currency) {
    throw new Error(
      `Payment currency mismatch for order ${order.orderNumber}: expected ${order.currency}, received ${currency}`
    );
  }

  await prisma.$transaction(async (tx) => {
    // 1. Payment idempotency guard: check if payment ID already captured
    const existingPayment = await tx.paymentTransaction.findUnique({
      where: { razorpayPaymentId: providerPaymentId },
    });

    if (existingPayment && existingPayment.status === PaymentStatus.CAPTURED) {
      // Duplicate captured event; already committed
      return;
    }

    if (order.status === OrderStatus.PAID) {
      // Order already paid; just record payment transaction if needed
      await tx.paymentTransaction.upsert({
        where: { razorpayPaymentId: providerPaymentId },
        create: {
          orderId: order.id,
          provider: "RAZORPAY",
          status: PaymentStatus.CAPTURED,
          amount,
          currency,
          razorpayOrderId: providerOrderId,
          razorpayPaymentId: providerPaymentId,
          capturedAt: new Date(),
          rawWebhookPayload: rawPayload ? (rawPayload as Prisma.InputJsonValue) : Prisma.JsonNull,
        },
        update: {
          status: PaymentStatus.CAPTURED,
          capturedAt: new Date(),
          ...(rawPayload ? { rawWebhookPayload: rawPayload as Prisma.InputJsonValue } : {}),
        },
      });
      return;
    }

    const now = new Date();

    // 2. Normal path: Reservation is ACTIVE
    if (order.reservation.status === ReservationStatus.ACTIVE) {
      // Transition reservation to COMMITTED
      await tx.inventoryReservation.update({
        where: { id: order.reservationId },
        data: { status: ReservationStatus.COMMITTED, committedAt: now },
      });

      // Transition order to PAID
      await tx.order.update({
        where: { id: order.id },
        data: { status: OrderStatus.PAID, updatedAt: now },
      });

      // Aggregate bulk inventory by SKU across all items
      const bulkDeltas = new Map<string, number>();
      for (const item of order.reservation.items) {
        for (const comp of item.variant.components) {
          if (comp.componentType === "PHYSICAL_ITEM") {
            if (!comp.inventorySku || comp.quantity <= 0) {
              throw new Error(`Invalid physical inventory component ${comp.id}`);
            }
            const current = bulkDeltas.get(comp.inventorySku) || 0;
            bulkDeltas.set(comp.inventorySku, current + comp.quantity * item.quantity);
          }
        }
      }

      for (const [sku, needed] of [...bulkDeltas.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        const updated = await tx.$executeRaw`
          UPDATE "InventoryStock"
          SET "quantityOnHand" = "quantityOnHand" - ${needed},
              "reservedCount" = "reservedCount" - ${needed},
              "updatedAt" = NOW()
          WHERE sku = ${sku}
            AND "quantityOnHand" >= ${needed}
            AND "reservedCount" >= ${needed}
        `;
        if (updated !== 1) {
          throw new Error(`Inventory stock counters inconsistent for SKU ${sku}; reconciliation required.`);
        }
      }

      // In the Pick-to-Scan fulfillment model, physical QR tags are NOT pre-allocated at payment time.
      // The order is marked PAID and placed in the warehouse packing queue.
      // Warehouse workers scan physical tags to allocate them during the PackingSession.

      // Create at most one SubscriptionGrant per qualifying order
      const plusDurationMonths = calculatePlusDurationFromOrder(order);
      if (plusDurationMonths > 0) {
        await tx.subscriptionGrant.upsert({
          where: { orderId: order.id },
          create: {
            orderId: order.id,
            userId: order.userId,
            grantKey: `order:${order.id}:plus`,
            plusDurationMonths,
            status: order.userId ? GrantStatus.PENDING_PAIRING : GrantStatus.PENDING_CLAIM,
          },
          update: {},
        });
      }

      // Upsert payment transaction to CAPTURED
      await tx.paymentTransaction.upsert({
        where: { razorpayPaymentId: providerPaymentId },
        create: {
          orderId: order.id,
          provider: "RAZORPAY",
          status: PaymentStatus.CAPTURED,
          amount,
          currency,
          razorpayOrderId: providerOrderId,
          razorpayPaymentId: providerPaymentId,
          capturedAt: now,
          rawWebhookPayload: rawPayload ? (rawPayload as Prisma.InputJsonValue) : Prisma.JsonNull,
        },
        update: {
          status: PaymentStatus.CAPTURED,
          capturedAt: now,
          ...(rawPayload ? { rawWebhookPayload: rawPayload as Prisma.InputJsonValue } : {}),
        },
      });
      return;
    }

    // 3. Late Payment Reconciliation: Reservation is EXPIRED or RELEASED
    // Attempt to re-reserve the entire bundle atomically
    const physicalItemDeltas = new Map<string, number>();
    const serializedRequirements = new Map<string, Array<{ componentId: string; needed: number }>>();
    const selectedTags: Array<{ id: string; tagNumber: string; componentId: string }> = [];

    for (const item of order.reservation.items) {
      for (const comp of item.variant.components) {
        if (comp.componentType === "SERIALIZED_QR_TAG") {
          if (!comp.inventorySku) throw new Error(`Missing inventorySku for ${comp.id}`);
          const reqs = serializedRequirements.get(comp.inventorySku) || [];
          reqs.push({ componentId: comp.id, needed: comp.quantity * item.quantity });
          serializedRequirements.set(comp.inventorySku, reqs);
        } else if (comp.componentType === "PHYSICAL_ITEM") {
          if (!comp.inventorySku) throw new Error(`Missing inventorySku for ${comp.id}`);
          const cur = physicalItemDeltas.get(comp.inventorySku) || 0;
          physicalItemDeltas.set(comp.inventorySku, cur + comp.quantity * item.quantity);
        }
      }
    }

    let bundleAvailable = true;

    // Check serialized tags available in warehouse pool
    for (const [sku, requirements] of [...serializedRequirements.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const needed = requirements.reduce((s, r) => s + r.needed, 0);
      const availableResult = await tx.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(q.id) as count
        FROM "QrTag" q
        JOIN "QrTagInventory" qi ON qi."qrTagId" = q.id
        WHERE q.status = 'UNASSIGNED'
          AND q.origin = 'PREPRINTED_INVENTORY'
          AND qi.sku = ${sku}
          AND qi.state = 'IN_STOCK';
      `;
      const available = Number(availableResult[0]?.count ?? 0);
      if (available < needed) {
        bundleAvailable = false;
        break;
      }
    }

    // Check bulk items
    if (bundleAvailable) {
      for (const [sku, count] of physicalItemDeltas.entries()) {
        const stock = await tx.inventoryStock.findUnique({ where: { sku } });
        if (!stock || stock.quantityOnHand - stock.reservedCount < count) {
          bundleAvailable = false;
          break;
        }
      }
    }

    if (bundleAvailable) {
      // Re-reservation succeeded! Commit commercial inventory immediately
      for (const [sku, count] of physicalItemDeltas.entries()) {
        await tx.$executeRaw`
          UPDATE "InventoryStock"
          SET "quantityOnHand" = "quantityOnHand" - ${count}, "updatedAt" = NOW()
          WHERE sku = ${sku}
            AND "quantityOnHand" >= ${count}
        `;
      }

      await tx.order.update({
        where: { id: order.id },
        data: { status: OrderStatus.PAID, updatedAt: now },
      });

      await tx.inventoryReservation.update({
        where: { id: order.reservationId },
        data: { status: ReservationStatus.COMMITTED, committedAt: now },
      });

      const plusDurationMonths = calculatePlusDurationFromOrder(order);
      if (plusDurationMonths > 0) {
        await tx.subscriptionGrant.upsert({
          where: { orderId: order.id },
          create: {
            orderId: order.id,
            userId: order.userId,
            grantKey: `order:${order.id}:plus`,
            plusDurationMonths,
            status: order.userId ? GrantStatus.PENDING_PAIRING : GrantStatus.PENDING_CLAIM,
          },
          update: {},
        });
      }

      await tx.outboxJob.upsert({
        where: { dedupeKey: `order:${order.id}:fulfill` },
        create: {
          type: "FULFILL_ORDER",
          dedupeKey: `order:${order.id}:fulfill`,
          payload: { orderId: order.id, orderNumber: order.orderNumber, lateReconciled: true },
          status: OutboxStatus.PENDING,
        },
        update: {},
      });

      await tx.paymentTransaction.upsert({
        where: { razorpayPaymentId: providerPaymentId },
        create: {
          orderId: order.id,
          provider: "RAZORPAY",
          status: PaymentStatus.CAPTURED,
          amount,
          currency,
          razorpayOrderId: providerOrderId,
          razorpayPaymentId: providerPaymentId,
          capturedAt: now,
          rawWebhookPayload: rawPayload ? (rawPayload as Prisma.InputJsonValue) : Prisma.JsonNull,
        },
        update: {
          status: PaymentStatus.CAPTURED,
          capturedAt: now,
          ...(rawPayload ? { rawWebhookPayload: rawPayload as Prisma.InputJsonValue } : {}),
        },
      });
    } else {
      // Stock is unavailable: record payment as RECONCILIATION_REQUIRED and enqueue refund job
      await tx.paymentTransaction.upsert({
        where: { razorpayPaymentId: providerPaymentId },
        create: {
          orderId: order.id,
          provider: "RAZORPAY",
          status: PaymentStatus.RECONCILIATION_REQUIRED,
          amount,
          currency,
          razorpayOrderId: providerOrderId,
          razorpayPaymentId: providerPaymentId,
          capturedAt: now,
          errorDescription: "Late payment arrived after reservation expired and replacement inventory was unavailable.",
          rawWebhookPayload: rawPayload ? (rawPayload as Prisma.InputJsonValue) : Prisma.JsonNull,
        },
        update: {
          status: PaymentStatus.RECONCILIATION_REQUIRED,
          capturedAt: now,
          errorDescription: "Late payment arrived after reservation expired and replacement inventory was unavailable.",
          ...(rawPayload ? { rawWebhookPayload: rawPayload as Prisma.InputJsonValue } : {}),
        },
      });

      await tx.outboxJob.upsert({
        where: { dedupeKey: `order:${order.id}:refund` },
        create: {
          type: "REQUEST_REFUND",
          dedupeKey: `order:${order.id}:refund`,
          payload: {
            orderId: order.id,
            orderNumber: order.orderNumber,
            providerPaymentId,
            amount,
            reason: "STOCK_UNAVAILABLE_AFTER_EXPIRY",
          },
          status: OutboxStatus.PENDING,
        },
        update: {},
      });
    }
  });
};

/**
 * Reconciles a failed payment transaction without downgrading an already PAID order.
 */
export const reconcileFailedPayment = async (input: {
  providerOrderId: string;
  providerPaymentId?: string | undefined;
  failureCode?: string | undefined;
  failureDescription?: string | undefined;
  rawPayload?: any;
}): Promise<void> => {
  const { providerOrderId, providerPaymentId, failureCode, failureDescription, rawPayload } = input;

  const order = await prisma.order.findUnique({
    where: { razorpayOrderId: providerOrderId },
  });

  if (!order) return;

  // Never downgrade an order already confirmed PAID
  if (order.status === OrderStatus.PAID) return;

  await prisma.paymentTransaction.create({
    data: {
      orderId: order.id,
      provider: "RAZORPAY",
      status: PaymentStatus.FAILED,
      amount: order.totalAmount,
      currency: order.currency,
      razorpayOrderId: providerOrderId,
      razorpayPaymentId: providerPaymentId ?? null,
      failureCode: failureCode ?? null,
      errorDescription: failureDescription ?? null,
      rawWebhookPayload: rawPayload ? (rawPayload as Prisma.InputJsonValue) : Prisma.JsonNull,
    },
  });
};

/**
/**
 * Formats full tracking payload combining internal order milestones and Shiprocket live tracking.
 */
const formatUnifiedOrderTracking = async (order: any) => {
  const latestPayment = order.payments?.[0] ?? null;
  const activeShipment = order.shipments?.[0] ?? null;
  const latestPacking = order.packingSessions?.[0] ?? null;

  // 1. Build chronological internal milestones
  const internalMilestones = [
    {
      key: "ORDER_PLACED",
      label: "Order Placed",
      status: "COMPLETED",
      timestamp: order.createdAt,
    },
    {
      key: "PAYMENT_CONFIRMED",
      label: "Payment Confirmed",
      status: order.status !== OrderStatus.PAYMENT_PENDING ? "COMPLETED" : "PENDING",
      timestamp: latestPayment?.capturedAt ?? null,
    },
    {
      key: "PACKING",
      label: "Packed and Ready to Ship",
      status: [OrderStatus.PACKED, OrderStatus.SHIPPED, OrderStatus.DELIVERED].includes(order.status)
        ? "COMPLETED"
        : order.status === OrderStatus.PACKING || latestPacking?.status === "IN_PROGRESS"
        ? "IN_PROGRESS"
        : "PENDING",
      timestamp: latestPacking?.completedAt ?? null,
    },
    {
      key: "SHIPPED",
      label: "Handed to Courier",
      status: [OrderStatus.SHIPPED, OrderStatus.DELIVERED].includes(order.status)
        ? "COMPLETED"
        : "PENDING",
      timestamp: activeShipment?.shippedAt ?? null,
    },
    {
      key: "DELIVERED",
      label: "Delivered",
      status: order.status === OrderStatus.DELIVERED ? "COMPLETED" : "PENDING",
      timestamp: activeShipment?.deliveredAt ?? null,
    },
  ];

  // 2. Fetch live Shiprocket courier tracking if shipment & AWB are present
  let shipmentData: any = null;
  if (activeShipment) {
    let liveCarrierTracking = null;
    if (activeShipment.awbCode) {
      liveCarrierTracking = await shiprocketClient.getTrackingByAwb(
        activeShipment.awbCode,
        activeShipment.courierName ?? "Courier Partner",
        activeShipment.status
      );
    }

    shipmentData = {
      id: activeShipment.id,
      status: activeShipment.status,
      courierName: activeShipment.courierName ?? "Express Logistics",
      awbCode: activeShipment.awbCode ?? null,
      trackingUrl: activeShipment.trackingUrl ?? (liveCarrierTracking?.trackUrl ?? null),
      labelUrl: activeShipment.labelUrl ?? null,
      manifestUrl: activeShipment.manifestUrl ?? null,
      shippedAt: activeShipment.shippedAt ?? null,
      deliveredAt: activeShipment.deliveredAt ?? null,
      carrierLiveTracking: liveCarrierTracking,
    };
  }

  return {
    orderNumber: order.orderNumber,
    status: order.status,
    totalAmount: order.totalAmount,
    currency: order.currency,
    isClaimed: Boolean(order.userId || order.purchaseClaim),
    paymentStatus: latestPayment?.status ?? "PENDING",
    razorpayOrderId: order.razorpayOrderId,
    customerEmail: order.customerEmail ? maskEmail(order.customerEmail) : null,
    customerPhone: order.customerPhone ? maskPhone(order.customerPhone) : null,
    shippingAddress: order.shippingAddress
      ? {
          fullName: order.shippingAddress.fullName,
          phoneNumber: order.shippingAddress.phoneNumber,
          addressLine1: order.shippingAddress.addressLine1,
          addressLine2: order.shippingAddress.addressLine2,
          city: order.shippingAddress.city,
          state: order.shippingAddress.state,
          postalCode: order.shippingAddress.postalCode,
          country: order.shippingAddress.country || "IN",
        }
      : null,
    items: await Promise.all(
      order.items.map(async (i: any) => {
        const snap = i.productSnapshot as any;
        const productName = snap?.product?.name || snap?.variant?.name || "Product";
        const variantName = snap?.variant?.name || "Pack";
        const resolved = await resolveOrderImages(i);
        return {
          id: i.id,
          productName,
          variantName,
          name: productName !== variantName ? `${productName} (${variantName})` : productName,
          quantity: i.quantity,
          totalPrice: i.totalPrice,
          imageUrl: resolved.imageUrl,
          imageReference: resolved.imageReference,
        };
      })
    ),
    internalMilestones,
    shipment: shipmentData,
    createdAt: order.createdAt,
  };
};

/**
 * Retrieves public/safe order and payment status by orderNumber.
 */
export const getOrderStatus = async (orderNumber: string) => {
  const order = await prisma.order.findUnique({
    where: { orderNumber },
    include: {
      shippingAddress: true,
      items: {
        include: {
          variant: {
            include: { product: true },
          },
        },
      },
      payments: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
      shipments: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
      packingSessions: {
        orderBy: { sessionNumber: "desc" },
        take: 1,
      },
      subscriptionGrants: true,
      purchaseClaim: true,
    },
  });

  if (!order) {
    throw new NotFoundError(`Order ${orderNumber} not found.`);
  }

  return await formatUnifiedOrderTracking(order);
};

/**
 * Public unified tracking by either orderNumber OR courier AWB code.
 */
export const trackOrderPublicly = async (identifier: string) => {
  const trimmed = identifier.trim();

  // Search by orderNumber OR awbCode
  let order = await prisma.order.findUnique({
    where: { orderNumber: trimmed },
    include: {
      shippingAddress: true,
      items: {
        include: {
          variant: {
            include: { product: true },
          },
        },
      },
      payments: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
      shipments: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
      packingSessions: {
        orderBy: { sessionNumber: "desc" },
        take: 1,
      },
      subscriptionGrants: true,
      purchaseClaim: true,
    },
  });

  if (!order) {
    // Attempt lookup by AWB code on Shipment
    const shipment = await prisma.shipment.findUnique({
      where: { awbCode: trimmed },
      include: {
        order: {
          include: {
            shippingAddress: true,
            items: {
              include: {
                variant: {
                  include: { product: true },
                },
              },
            },
            payments: {
              orderBy: { createdAt: "desc" },
              take: 1,
            },
            shipments: {
              orderBy: { createdAt: "desc" },
              take: 1,
            },
            packingSessions: {
              orderBy: { sessionNumber: "desc" },
              take: 1,
            },
            subscriptionGrants: true,
            purchaseClaim: true,
          },
        },
      },
    });

    if (shipment?.order) {
      order = shipment.order;
    }
  }

  if (!order) {
    throw new NotFoundError(`No tracking details found for '${identifier}'. Please check your order number or AWB.`);
  }

  return await formatUnifiedOrderTracking(order);
};

const maskEmail = (email: string): string => {
  const [name, domain] = email.split("@");
  if (!name || !domain) return email;
  const maskedName = name.length <= 2 ? name[0] + "***" : name.slice(0, 2) + "***" + name.slice(-1);
  return `${maskedName}@${domain}`;
};

const maskPhone = (phone: string): string => {
  if (phone.length < 4) return phone;
  return phone.slice(0, 2) + "******" + phone.slice(-2);
};
