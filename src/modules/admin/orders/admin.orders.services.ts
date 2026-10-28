import { OrderStatus, Prisma } from "@prisma/client";
import { prisma } from "../../../lib/prisma.js";
import { NotFoundError } from "../../../errors/AppError.js";
import { resolveOrderImages, resolveOrderListImages } from "../../catalog/catalog-images.service.js";
import {
  decryptPhoneNumber,
  decryptShippingAddress,
} from "../../../utils/data-protection.js";

export interface AdminListOrdersQuery {
  page?: number | undefined;
  limit?: number | undefined;
  status?: OrderStatus | undefined;
  search?: string | undefined;
  startDate?: Date | undefined;
  endDate?: Date | undefined;
}

/**
 * List orders with pagination, status filtering, customer search, and date ranges.
 */
export const adminListOrders = async ({
  page = 1,
  limit = 20,
  status,
  search,
  startDate,
  endDate,
}: AdminListOrdersQuery) => {
  const skip = (page - 1) * limit;

  const where: Prisma.OrderWhereInput = {};

  if (status) {
    where.status = status;
  }

  if (startDate || endDate) {
    where.createdAt = {
      ...(startDate ? { gte: startDate } : {}),
      ...(endDate ? { lte: endDate } : {}),
    };
  }

  if (search) {
    where.OR = [
      { orderNumber: { contains: search, mode: "insensitive" } },
      { customerEmail: { contains: search, mode: "insensitive" } },
      { customerPhone: { contains: search } },
      {
        shippingAddress: {
          fullName: { contains: search, mode: "insensitive" },
        },
      },
    ];
  }

  const [total, orders] = await prisma.$transaction([
    prisma.order.count({ where }),
    prisma.order.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
      include: {
        user: {
          select: { id: true, name: true, mobileNumber: true },
        },
        shippingAddress: true,
        items: {
          include: {
            variant: {
              include: {
                product: {
                  select: { name: true, sku: true, slug: true, imageUrl: true },
                },
              },
            },
          },
        },
        tagAllocations: {
          include: {
            qrTag: {
              select: { id: true, tagNumber: true, status: true },
            },
          },
        },
        payments: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
        shipments: {
          take: 1,
        },
        subscriptionGrants: true,
        purchaseClaim: true,
      },
    }),
  ]);

  return {
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
    orders: await resolveOrderListImages(
      orders.map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        status: o.status,
        totalAmount: o.totalAmount,
        subtotalAmount: o.subtotalAmount,
        currency: o.currency,
        customerEmail: o.customerEmail,
        customerPhone: o.customerPhone ? decryptPhoneNumber(o.customerPhone) : o.customerPhone,
        isClaimed: Boolean(o.userId || o.purchaseClaim),
        user: o.user
          ? {
              ...o.user,
              mobileNumber: decryptPhoneNumber(o.user.mobileNumber),
            }
          : null,
        shippingAddress: decryptShippingAddress(o.shippingAddress),
        itemCount: o.items.reduce((sum, item) => sum + item.quantity, 0),
        items: o.items.map((i) => {
          const snap = i.productSnapshot as any;
          const productName = snap?.product?.name || i.variant?.product?.name || snap?.variant?.name || "Product";
          const variantName = snap?.variant?.name || i.variant?.name || "Standard";
          return {
            id: i.id,
            productName,
            variantName,
            name: productName !== variantName ? `${productName} (${variantName})` : productName,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
            totalPrice: i.totalPrice,
            productSnapshot: i.productSnapshot,
            variant: i.variant,
          };
        }),
        allocatedTags: o.tagAllocations.map((a) => a.qrTag.tagNumber),
        payment: o.payments[0]
          ? {
              provider: o.payments[0].provider,
              status: o.payments[0].status,
              razorpayPaymentId: o.payments[0].razorpayPaymentId,
              capturedAt: o.payments[0].capturedAt,
            }
          : null,
        shipment: o.shipments[0]
          ? {
              status: o.shipments[0].status,
              courierName: o.shipments[0].courierName,
              awbCode: o.shipments[0].awbCode,
              trackingUrl: o.shipments[0].trackingUrl,
            }
          : null,
        hasSubscriptionGrant: o.subscriptionGrants.length > 0,
        grantStatus: o.subscriptionGrants[0]?.status ?? null,
        createdAt: o.createdAt,
        updatedAt: o.updatedAt,
      }))
    ),
  };
};

/**
 * Detailed view of a single order for admin dashboard.
 */
export const adminGetOrderById = async (orderId: string) => {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      user: {
        select: { id: true, name: true, mobileNumber: true, role: true },
      },
      shippingAddress: true,
      items: {
        include: {
          variant: {
            include: {
              product: true,
            },
          },
        },
      },
      tagAllocations: {
        include: {
          qrTag: {
            include: {
              inventory: true,
              resource: {
                select: { id: true, name: true, type: true },
              },
            },
          },
        },
      },
      payments: {
        orderBy: { createdAt: "desc" },
      },
      shipments: true,
      subscriptionGrants: true,
      purchaseClaim: true,
      reservation: {
        include: {
          items: true,
        },
      },
    },
  });

  if (!order) {
    throw new NotFoundError(`Order with ID ${orderId} not found.`);
  }

  const resolvedItems = await Promise.all(
    order.items.map(async (item) => {
      return await resolveOrderImages(item);
    })
  );

  return {
    ...order,
    user: order.user
      ? {
          ...order.user,
          mobileNumber: decryptPhoneNumber(order.user.mobileNumber),
        }
      : null,
    customerPhone: order.customerPhone ? decryptPhoneNumber(order.customerPhone) : order.customerPhone,
    shippingAddress: decryptShippingAddress(order.shippingAddress),
    items: resolvedItems,
  };
};

/**
 * Admin: update an order's status.
 */
export const adminUpdateOrderStatus = async (orderId: string, newStatus: OrderStatus) => {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) {
    throw new NotFoundError(`Order with ID ${orderId} not found.`);
  }

  const updated = await prisma.order.update({
    where: { id: orderId },
    data: {
      status: newStatus,
      ...(newStatus === OrderStatus.DELIVERED ? { deliveredAt: order.deliveredAt ?? new Date() } : {}),
      updatedAt: new Date(),
    },
  });

  return updated;
};

/**
 * Aggregate metrics across orders (total orders, total revenue, status breakdown).
 */
export const adminGetOrderMetrics = async () => {
  const [totalOrders, paidOrders, pendingOrders, revenueResult] =
    await prisma.$transaction([
      prisma.order.count(),
      prisma.order.count({ where: { status: OrderStatus.PAID } }),
      prisma.order.count({ where: { status: OrderStatus.PAYMENT_PENDING } }),
      prisma.order.aggregate({
        where: {
          status: {
            in: [
              OrderStatus.PAID,
              OrderStatus.PACKING,
              OrderStatus.PACKED,
              OrderStatus.SHIPPED,
              OrderStatus.DELIVERED,
            ],
          },
        },
        _sum: { totalAmount: true },
      }),
    ]);

  const byStatus = await Promise.all(
    Object.values(OrderStatus).map(async (status) => {
      const count = await prisma.order.count({ where: { status } });
      return { status, count };
    })
  );

  const totalRevenuePaise = revenueResult._sum.totalAmount ?? 0;

  return {
    totalOrders,
    paidOrders,
    pendingOrders,
    totalRevenuePaise,
    totalRevenueRupees: Math.round(totalRevenuePaise / 100),
    byStatus: byStatus.filter((s) => s.count > 0),
  };
};
