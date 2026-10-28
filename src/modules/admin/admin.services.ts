import { prisma } from "../../lib/prisma.js";
import { QrTagStatus, QrTagOrigin, OrderStatus } from "@prisma/client";
import { decryptPhoneNumber, decryptData, generatePhoneLookup } from "../../utils/data-protection.js";
import { getConsolidatedTagCounts } from "./overview/admin.overview.services.js";

// ---------------------------------------------------------------------------
// USERS
// ---------------------------------------------------------------------------

export interface AdminUsersQuery {
  page?: number | undefined;
  limit?: number | undefined;
  search?: string | undefined;
  activeOnly?: boolean | undefined;
}

/**
 * List all users with optional filtering and pagination.
 */
export const adminListUsers = async ({
  page = 1,
  limit = 20,
  search,
  activeOnly = true,
}: AdminUsersQuery) => {
  const skip = (page - 1) * limit;

  const where: Record<string, unknown> = {};

  if (activeOnly) {
    where.active = true;
  }

  if (search) {
    const orConditions: any[] = [
      { name: { contains: search, mode: "insensitive" } },
      { mobileNumber: { contains: search } },
    ];
    try {
      const lookup = generatePhoneLookup(search);
      orConditions.push({ mobileLookup: lookup });
    } catch {
      // ignore search strings that cannot be normalized as phone numbers
    }
    where.OR = orConditions;
  }

  const [total, users] = await prisma.$transaction([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        mobileNumber: true,
        active: true,
        createdAt: true,
        _count: {
          select: {
            resources: true,
          },
        },
        contactEndpoint: {
          select: {
            id: true,
            type: true,
            createdAt: true,
          },
        },
      },
    }),
  ]);

  return {
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
    users: users.map((u) => ({
      id: u.id,
      name: u.name,
      mobileNumber: decryptPhoneNumber(u.mobileNumber),
      active: u.active,
      createdAt: u.createdAt,
      resourceCount: u._count.resources,
      hasContactEndpoint: Boolean(u.contactEndpoint),
    })),
  };
};

/**
 * Get detailed information about a single user by ID.
 */
export const adminGetUserById = async (userId: string) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      resources: {
        where: { active: true },
        include: {
          vehicleDetail: true,
          contactLink: { select: { token: true, active: true } },
          qrTag: {
            where: { status: QrTagStatus.ASSIGNED },
            select: {
              id: true,
              tagNumber: true,
              status: true,
              origin: true,
              assignedAt: true,
            },
          },
        },
      },
      contactEndpoint: {
        select: {
          id: true,
          type: true,
          createdAt: true,
        },
      },
    },
  });

  if (!user) return null;

  return {
    id: user.id,
    name: user.name,
    mobileNumber: decryptPhoneNumber(user.mobileNumber),
    active: user.active,
    createdAt: user.createdAt,
    hasContactEndpoint: Boolean(user.contactEndpoint),
    contactEndpoint: user.contactEndpoint,
    resources: user.resources.map((r) => ({
      id: r.id,
      name: decryptData(r.name),
      type: r.type,
      registrationNum: r.vehicleDetail?.registrationNum ? decryptData(r.vehicleDetail.registrationNum) : null,
      vehicleColour: r.vehicleDetail?.vehicleColour ?? null,
      qrTag: r.qrTag[0] ?? null,
    })),
  };
};

// ---------------------------------------------------------------------------
// QR INVENTORY
// ---------------------------------------------------------------------------

export interface AdminQrInventoryQuery {
  page?: number | undefined;
  limit?: number | undefined;
  status?: QrTagStatus | undefined;
  origin?: QrTagOrigin | undefined;
}

/**
 * List all QR tags in the system with filter support.
 */
export const adminListQrTags = async ({
  page = 1,
  limit = 50,
  status,
  origin,
}: AdminQrInventoryQuery) => {
  const skip = (page - 1) * limit;

  const where: Record<string, unknown> = {};
  if (status) where.status = status;
  if (origin) where.origin = origin;

  const [total, tags] = await prisma.$transaction([
    prisma.qrTag.count({ where }),
    prisma.qrTag.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        tagNumber: true,
        origin: true,
        status: true,
        assignmentMethod: true,
        assignedAt: true,
        createdAt: true,
        resource: {
          select: {
            id: true,
            name: true,
            type: true,
            userId: true,
            user: { select: { id: true, name: true, mobileNumber: true } },
          },
        },
      },
    }),
  ]);

  return {
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
    tags: tags.map((t) => ({
      id: t.id,
      tagNumber: t.tagNumber,
      origin: t.origin,
      status: t.status,
      assignmentMethod: t.assignmentMethod,
      assignedAt: t.assignedAt,
      createdAt: t.createdAt,
      resource: t.resource
        ? {
            id: t.resource.id,
            name: decryptData(t.resource.name),
            type: t.resource.type,
            owner: t.resource.user
              ? {
                  ...t.resource.user,
                  mobileNumber: decryptPhoneNumber(t.resource.user.mobileNumber),
                }
              : null,
          }
        : null,
    })),
  };
};

/**
 * Get QR tag inventory summary counts by status.
 */
export const adminQrInventorySummary = async () => {
  const [total, assigned, unassigned, revoked, consolidated] = await Promise.all([
    prisma.qrTag.count(),
    prisma.qrTag.count({ where: { status: QrTagStatus.ASSIGNED } }),
    prisma.qrTag.count({ where: { status: QrTagStatus.UNASSIGNED } }),
    prisma.qrTag.count({ where: { status: QrTagStatus.REVOKED } }),
    getConsolidatedTagCounts(),
  ]);

  const byOrigin = await prisma.qrTag.groupBy({
    by: ["origin"],
    _count: { id: true },
  });

  return {
    total,
    assigned,
    unassigned,
    revoked,
    readyToSell: consolidated.readyToSell,
    inUse: consolidated.inUse,
    inWarehouse: consolidated.inWarehouse,
    reserved: consolidated.reserved,
    byOrigin: byOrigin.map((o) => ({ origin: o.origin, count: o._count.id })),
  };
};

/**
 * Admin: Revoke a QR tag (cannot be re-activated without a new generation).
 */
export const adminRevokeQrTag = async (tagId: string) => {
  const tag = await prisma.qrTag.findUnique({ where: { id: tagId } });

  if (!tag) return null;

  const now = new Date();

  await prisma.$transaction(async (tx) => {
    if (tag.status === QrTagStatus.ASSIGNED && tag.resourceId) {
      await tx.qrAssignment.updateMany({
        where: { qrTagId: tag.id, unassignedAt: null },
        data: { unassignedAt: now },
      });
    }

    await tx.qrTag.update({
      where: { id: tagId },
      data: {
        status: QrTagStatus.REVOKED,
        resourceId: null,
        assignmentMethod: null,
        assignedAt: null,
      },
    });
  });

  return { tagId: tag.id, tagNumber: tag.tagNumber, status: QrTagStatus.REVOKED };
};

// ---------------------------------------------------------------------------
// COMMUNICATION / CALL REPORTS
// ---------------------------------------------------------------------------

export interface AdminCallReportQuery {
  page?: number | undefined;
  limit?: number | undefined;
  startDate?: Date | undefined;
  endDate?: Date | undefined;
  status?: string | undefined;
}

/**
 * List communication sessions with call details for reporting.
 */
export const adminListCommunicationSessions = async ({
  page = 1,
  limit = 50,
  startDate,
  endDate,
  status,
}: AdminCallReportQuery) => {
  const skip = (page - 1) * limit;

  const where: Record<string, unknown> = {};

  if (status) {
    where.OR = [
      { status: status as any },
      { calls: { some: { status: status as any } } },
    ];
  }

  if (startDate || endDate) {
    where.createdAt = {
      ...(startDate ? { gte: startDate } : {}),
      ...(endDate ? { lte: endDate } : {}),
    };
  }

  const [total, sessions] = await prisma.$transaction([
    prisma.communicationSession.count({ where }),
    prisma.communicationSession.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
      include: {
        resource: {
          select: {
            id: true,
            name: true,
            type: true,
            user: { select: { id: true, name: true, mobileNumber: true } },
          },
        },
        calls: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            callSid: true,
            caller: true,
            callee: true,
            direction: true,
            status: true,
            durationSec: true,
            incomingAt: true,
            connectedAt: true,
            endedAt: true,
          },
        },
      },
    }),
  ]);

  const safeDecrypt = (val: string | null | undefined, fallback: string = "") => {
    if (!val) return fallback;
    try {
      return decryptData(val);
    } catch {
      return fallback;
    }
  };

  const safeDecryptPhone = (val: string | null | undefined, fallback: string = "") => {
    if (!val) return fallback;
    try {
      return decryptPhoneNumber(val);
    } catch {
      return fallback;
    }
  };

  return {
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
    sessions: sessions.map((s) => {
      const latestCall = s.calls[s.calls.length - 1];
      const effectiveStatus = latestCall?.status ?? s.status;
      return {
        id: s.id,
        reference: s.reference,
        type: s.type,
        status: effectiveStatus,
        sessionStatus: s.status,
        provider: s.provider,
        createdAt: s.createdAt,
        expiresAt: s.expiresAt,
        endedAt: s.endedAt ?? latestCall?.endedAt ?? null,
        resource: {
          id: s.resource.id,
          name: safeDecrypt(s.resource.name, "Vehicle Tag"),
          type: s.resource.type,
          owner: s.resource.user
            ? {
                ...s.resource.user,
                mobileNumber: safeDecryptPhone(s.resource.user.mobileNumber, "—"),
              }
            : null,
        },
        calls: s.calls.map((c) => ({
          ...c,
          caller: c.caller ? safeDecryptPhone(c.caller, c.caller) : c.caller,
          callee: c.callee ? safeDecryptPhone(c.callee, c.callee) : c.callee,
        })),
        callCount: s.calls.length,
        totalDurationSec: s.calls.reduce((acc, c) => acc + (c.durationSec ?? 0), 0),
      };
    }),
  };
};

// ---------------------------------------------------------------------------
// DASHBOARD SUMMARY
// ---------------------------------------------------------------------------

/**
 * Get a high-level summary of the system for the admin dashboard.
 */
export const adminDashboardSummary = async () => {
  const [
    totalUsers,
    activeUsers,
    totalResources,
    totalQrTags,
    assignedQrTags,
    totalSessions,
    recentSessions,
    totalOrders,
    paidOrders,
    revenueResult,
    recentOrders,
  ] = await prisma.$transaction([
    prisma.user.count(),
    prisma.user.count({ where: { active: true } }),
    prisma.resource.count({ where: { active: true } }),
    prisma.qrTag.count(),
    prisma.qrTag.count({ where: { status: QrTagStatus.ASSIGNED } }),
    prisma.communicationSession.count(),
    prisma.communicationSession.findMany({
      take: 5,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        reference: true,
        type: true,
        status: true,
        createdAt: true,
        calls: {
          take: 1,
          orderBy: { createdAt: "desc" },
          select: { status: true },
        },
        resource: {
          select: {
            name: true,
            user: { select: { name: true } },
          },
        },
      },
    }),
    prisma.order.count(),
    prisma.order.count({ where: { status: OrderStatus.PAID } }),
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
    prisma.order.findMany({
      take: 5,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        totalAmount: true,
        customerEmail: true,
        customerPhone: true,
        createdAt: true,
      },
    }),
  ]);

  const totalRevenuePaise = revenueResult._sum.totalAmount ?? 0;
  const consolidated = await getConsolidatedTagCounts();

  return {
    users: { total: totalUsers, active: activeUsers },
    resources: { total: totalResources },
    qrTags: {
      total: totalQrTags,
      assigned: assignedQrTags,
      available: consolidated.readyToSell, // Unified definition: ready to sell (in warehouse minus reserved)
      readyToSell: consolidated.readyToSell,
      inUse: consolidated.inUse,
      inWarehouse: consolidated.inWarehouse,
      reserved: consolidated.reserved,
    },
    orders: {
      total: totalOrders,
      paid: paidOrders,
      totalRevenuePaise,
      totalRevenueRupees: Math.round(totalRevenuePaise / 100),
      recentOrders: recentOrders.map((o) => ({
        ...o,
        customerPhone: o.customerPhone ? decryptPhoneNumber(o.customerPhone) : o.customerPhone,
      })),
    },
    communications: { totalSessions },
    recentActivity: recentSessions.map((s) => ({
      id: s.id,
      reference: s.reference,
      type: s.type,
      status: s.calls[0]?.status ?? s.status,
      createdAt: s.createdAt,
      resourceName: s.resource.name,
      ownerName: s.resource.user.name,
    })),
  };
};
