import { prisma } from "../../../lib/prisma.js";
import { adminGetInventorySummary } from "../inventory/admin.inventory.services.js";
import { decryptData } from "../../../utils/data-protection.js";
import type {
  AdminOverviewResponse,
  AttentionItem,
  ConsolidatedTagCounts,
  OverviewActivationMetrics,
  OverviewActivityEvent,
  OverviewCallCostMetrics,
  OverviewFulfilmentMetrics,
  OverviewHealthMetrics,
  OverviewLifetimeMetrics,
  OverviewMeta,
  OverviewPeriod,
  OverviewPlusMetrics,
  OverviewSalesMetrics,
  OverviewUsageMetrics,
  PackAvailable,
  TopTagCost,
  UsageMetricPeriod,
} from "./admin.overview.types.js";

export const OVERVIEW_CONFIG = {
  callRatePerMinutePaise: 150, // ₹1.50 per billable minute
  callBillingLegs: 2,          // 2 legs (inbound + outbound)
  gstPercent: 18,              // 18% GST
  waitingForTagsTargetHours: 48, // 2 days
  unpaidCheckoutTargetHours: 24, // 1 day
  lateShipmentTargetHours: 168,  // 7 days
  lowStockReorderThreshold: 25, // SKUs at or below this trigger low stock warning
  legacySkus: ["TAG-VEHICLE-STICKER"],
  testCustomerEmails: ["tester@example.com", "pending.test@kauntact.in"],
  testUserNames: ["Abrar test"],
};

// In-memory 45-second cache
interface CachedOverview {
  data: AdminOverviewResponse;
  expiresAt: number;
}
const cache = new Map<string, CachedOverview>();
const CACHE_TTL_MS = 45 * 1000;

/**
 * Calculates start and end Date boundaries for the requested period using Asia/Kolkata (IST) midnight boundaries.
 * Guarantees previous range has exactly equal duration to the current period.
 */
export function getPeriodWindows(period: OverviewPeriod, referenceTime = new Date()): {
  now: Date;
  startOfPeriod: Date;
  endOfPeriod: Date;
  startOfPrevPeriod: Date;
  endOfPrevPeriod: Date;
} {
  const now = referenceTime;
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const istTime = new Date(now.getTime() + istOffsetMs);

  const istYear = istTime.getUTCFullYear();
  const istMonth = istTime.getUTCMonth();
  const istDate = istTime.getUTCDate();

  // Midnight (00:00:00.000 IST) of the current calendar day in UTC
  const todayStartIstUtc = new Date(Date.UTC(istYear, istMonth, istDate) - istOffsetMs);
  // End of today (23:59:59.999 IST) in UTC
  const todayEndIstUtc = new Date(todayStartIstUtc.getTime() + 24 * 60 * 60 * 1000 - 1);

  if (period === "today") {
    const startOfPeriod = todayStartIstUtc;
    const endOfPeriod = todayEndIstUtc;
    const startOfPrevPeriod = new Date(startOfPeriod.getTime() - 24 * 60 * 60 * 1000);
    const endOfPrevPeriod = new Date(endOfPeriod.getTime() - 24 * 60 * 60 * 1000);

    return {
      now,
      startOfPeriod,
      endOfPeriod,
      startOfPrevPeriod,
      endOfPrevPeriod,
    };
  }

  const days = period === "30d" ? 30 : 7;
  const durationMs = days * 24 * 60 * 60 * 1000;
  const endOfPeriod = todayEndIstUtc;
  const startOfPeriod = new Date(todayStartIstUtc.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
  const endOfPrevPeriod = new Date(startOfPeriod.getTime() - 1);
  const startOfPrevPeriod = new Date(startOfPeriod.getTime() - durationMs);

  return {
    now,
    startOfPeriod,
    endOfPeriod,
    startOfPrevPeriod,
    endOfPrevPeriod,
  };
}

/**
 * Maps internal product and SKU names to customer-facing store names.
 */
export function mapToStoreProductName(catalogProductName: string, sku = ""): { storeName: string; category: string } {
  const lower = (catalogProductName + " " + sku).toLowerCase();
  if (lower.includes("essential") || lower.includes("kt-bdl-ess")) {
    return { storeName: "Pair", category: "pair" };
  }
  if (lower.includes("curated") || lower.includes("kt-bdl-cur")) {
    return { storeName: "Complete set", category: "complete_set" };
  }
  if (lower.includes("vehicle sticker") || lower.includes("kt-vs-sgl")) {
    return { storeName: "Extra stickers", category: "stickers" };
  }
  if (lower.includes("keychain") || lower.includes("kt-kc-sgl")) {
    return { storeName: "Keychains", category: "keychains" };
  }
  if (lower.includes("mini sticker") || lower.includes("kt-ms-sgl")) {
    return { storeName: "Mini stickers", category: "mini_stickers" };
  }
  return { storeName: catalogProductName, category: sku || catalogProductName };
}

/**
 * Calculates visit-based conversion rate (visits with an initiated call / total visits).
 * Returns null if visits === 0. Mathematically bounded between 0 and 100.
 */
function computeVisitConversion(visitsWithCalls: number, totalVisits: number): number | null {
  if (totalVisits <= 0) return null;
  const rate = (visitsWithCalls / totalVisits) * 100;
  return Number(Math.min(100, Math.max(0, rate)).toFixed(1));
}

/**
 * Reuses the canonical warehouse inventory summary service to ensure 100% data consistency.
 */
export async function getConsolidatedTagCounts(): Promise<ConsolidatedTagCounts> {
  const inventory = await adminGetInventorySummary();
  return {
    readyToSell: inventory.totals.totalSellableStock,
    inUse: inventory.totals.assignedToVehicles,
    inWarehouse: inventory.totals.physicalStock,
    reserved: inventory.totals.totalCommittedDemand,
    totalPhysicalTags: inventory.totals.totalPhysicalTags,
  };
}

/**
 * Computes the unified Admin Overview metrics in SQL with integer paise and strict null handling.
 */
export async function getAdminOverview(
  period: OverviewPeriod = "7d",
  includeTest = false
): Promise<AdminOverviewResponse> {
  const nowMs = Date.now();
  const cacheKey = `${period}:${includeTest ? "withTest" : "noTest"}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > nowMs) {
    return {
      ...cached.data,
      meta: {
        ...cached.data.meta,
        cached: true,
      },
    };
  }

  const { now, startOfPeriod, endOfPeriod, startOfPrevPeriod, endOfPrevPeriod } = getPeriodWindows(period);
  const unavailable: string[] = [];

  // Concurrently execute database aggregations
  const [
    salesRows,
    waitingOrders,
    unpaidOrders,
    catalogProducts,
    inventorySummary,
    healthResults,
    lifetimeResults,
    recentPaidOrders,
    recentDeliveredOrders,
    recentCalls,
    recentAssignments,
    visitRows,
    convertedVisitRows,
    callRows,
    costRows,
    allTimeCostRows,
    topTagRows,
    deliveredTagsRows,
    linkedTagsRows,
    tagsWithCallsRows,
    medianDaysRows,
    plusBySourceRows,
    pendingGrantsRows,
    plusExpiring30dRows,
    nextExpiryRows,
  ] = await Promise.all([
    // 1. Sales Pipeline and Revenue in ONE Query
    prisma.$queryRaw<Array<{
      unpaid_count: number;
      unpaid_value: bigint | number;
      to_pack_count: number;
      to_pack_value: bigint | number;
      packing_count: number;
      packing_value: bigint | number;
      delivered_count: number;
      delivered_value: bigint | number;
      cancelled_refunded_count: number;
      cancelled_refunded_value: bigint | number;
      prev_paid_orders: number;
      prev_revenue: bigint | number;
    }>>`
      SELECT
        COUNT(*) FILTER (WHERE "createdAt" >= ${startOfPeriod} AND "createdAt" <= ${endOfPeriod} AND "status" = 'PAYMENT_PENDING')::integer AS unpaid_count,
        COALESCE(SUM("totalAmount") FILTER (WHERE "createdAt" >= ${startOfPeriod} AND "createdAt" <= ${endOfPeriod} AND "status" = 'PAYMENT_PENDING'), 0)::bigint AS unpaid_value,

        COUNT(*) FILTER (WHERE "createdAt" >= ${startOfPeriod} AND "createdAt" <= ${endOfPeriod} AND "status" = 'PAID')::integer AS to_pack_count,
        COALESCE(SUM("totalAmount") FILTER (WHERE "createdAt" >= ${startOfPeriod} AND "createdAt" <= ${endOfPeriod} AND "status" = 'PAID'), 0)::bigint AS to_pack_value,

        COUNT(*) FILTER (WHERE "createdAt" >= ${startOfPeriod} AND "createdAt" <= ${endOfPeriod} AND "status" IN ('PACKING', 'PACKED', 'SHIPPED'))::integer AS packing_count,
        COALESCE(SUM("totalAmount") FILTER (WHERE "createdAt" >= ${startOfPeriod} AND "createdAt" <= ${endOfPeriod} AND "status" IN ('PACKING', 'PACKED', 'SHIPPED')), 0)::bigint AS packing_value,

        COUNT(*) FILTER (WHERE "createdAt" >= ${startOfPeriod} AND "createdAt" <= ${endOfPeriod} AND "status" = 'DELIVERED')::integer AS delivered_count,
        COALESCE(SUM("totalAmount") FILTER (WHERE "createdAt" >= ${startOfPeriod} AND "createdAt" <= ${endOfPeriod} AND "status" = 'DELIVERED'), 0)::bigint AS delivered_value,

        COUNT(*) FILTER (WHERE "createdAt" >= ${startOfPeriod} AND "createdAt" <= ${endOfPeriod} AND "status" IN ('CANCELLED', 'REFUNDED'))::integer AS cancelled_refunded_count,
        COALESCE(SUM("totalAmount") FILTER (WHERE "createdAt" >= ${startOfPeriod} AND "createdAt" <= ${endOfPeriod} AND "status" IN ('CANCELLED', 'REFUNDED')), 0)::bigint AS cancelled_refunded_value,

        COUNT(*) FILTER (WHERE "createdAt" >= ${startOfPrevPeriod} AND "createdAt" <= ${endOfPrevPeriod} AND "status" IN ('PAID', 'PACKING', 'PACKED', 'SHIPPED', 'DELIVERED'))::integer AS prev_paid_orders,
        COALESCE(SUM("totalAmount") FILTER (WHERE "createdAt" >= ${startOfPrevPeriod} AND "createdAt" <= ${endOfPrevPeriod} AND "status" IN ('PAID', 'PACKING', 'PACKED', 'SHIPPED', 'DELIVERED')), 0)::bigint AS prev_revenue
      FROM "Order"
      WHERE (${includeTest} = true OR "customerEmail" IS NULL OR "customerEmail" NOT IN ('tester@example.com', 'pending.test@kauntact.in'));
    `,

    // 2. Orders waiting for tags (status = PAID)
    prisma.order.findMany({
      where: {
        status: "PAID",
        ...(includeTest
          ? {}
          : {
              OR: [
                { customerEmail: null },
                { customerEmail: { notIn: OVERVIEW_CONFIG.testCustomerEmails } },
              ],
            }),
      },
      select: {
        id: true,
        orderNumber: true,
        totalAmount: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    }),

    // 3. Unpaid checkouts with pending payment
    prisma.order.findMany({
      where: {
        status: "PAYMENT_PENDING",
        ...(includeTest
          ? {}
          : {
              OR: [
                { customerEmail: null },
                { customerEmail: { notIn: OVERVIEW_CONFIG.testCustomerEmails } },
              ],
            }),
      },
      select: {
        id: true,
        orderNumber: true,
        totalAmount: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    }),

    // 4. Catalog Products & Variants for packsAvailable
    prisma.product.findMany({
      where: { active: true },
      include: {
        variants: {
          where: { active: true },
          include: { components: true },
        },
      },
    }),

    // 5. Warehouse Inventory Summary
    adminGetInventorySummary(),

    // 6. System Health: Webhook Events & Outbox
    Promise.all([
      prisma.edesyWebhookEvent.findFirst({
        orderBy: { receivedAt: "desc" },
        select: { receivedAt: true },
      }),
      prisma.webhookInbox.findFirst({
        where: { provider: "RAZORPAY" },
        orderBy: { receivedAt: "desc" },
        select: { receivedAt: true },
      }),
      prisma.paymentTransaction.findFirst({
        where: { status: "CAPTURED" },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      }),
      prisma.outboxJob.count({
        where: {
          OR: [
            { status: "DEAD_LETTER" },
            { lastError: { not: null } },
          ],
          updatedAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
        },
      }),
    ]),

    // 7. Lifetime Metrics
    Promise.all([
      prisma.user.count({
        where: includeTest ? {} : { name: { notIn: OVERVIEW_CONFIG.testUserNames } },
      }),
      prisma.qrTag.count({
        where: { status: "ASSIGNED" },
      }),
      prisma.qrTag.count(),
    ]),

    // 8. Recent Paid Orders for Activity (status in PAID, PACKING, PACKED)
    prisma.order.findMany({
      where: {
        status: { in: ["PAID", "PACKING", "PACKED"] },
        ...(includeTest
          ? {}
          : {
              OR: [
                { customerEmail: null },
                { customerEmail: { notIn: OVERVIEW_CONFIG.testCustomerEmails } },
              ],
            }),
      },
      include: {
        user: true,
        shippingAddress: true,
        items: {
          include: { variant: { include: { product: true } } },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 8,
    }),

    // 9. Recent Delivered Orders for Activity
    prisma.order.findMany({
      where: {
        status: "DELIVERED",
        ...(includeTest
          ? {}
          : {
              OR: [
                { customerEmail: null },
                { customerEmail: { notIn: OVERVIEW_CONFIG.testCustomerEmails } },
              ],
            }),
      },
      include: {
        user: true,
        shippingAddress: true,
        items: {
          include: { variant: { include: { product: true } } },
        },
      },
      orderBy: { updatedAt: "desc" },
      take: 8,
    }),

    // 10. Recent Calls for Activity (tagged physical calls only)
    prisma.communicationCall.findMany({
      where: {
        session: {
          resource: {
            qrTag: { some: {} },
          },
        },
      },
      include: {
        session: {
          include: {
            resource: {
              include: { qrTag: true },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 8,
    }),

    // 11. Recent Tag Assignments for Activity
    prisma.qrAssignment.findMany({
      include: {
        qrTag: true,
        resource: {
          include: { user: true },
        },
      },
      orderBy: { assignedAt: "desc" },
      take: 8,
    }),

    // 12. Visit Stats
    prisma.$queryRaw<Array<{
      scans_current: number;
      scans_prev: number;
      scans_all_time: number;
      visits_current: number;
      visits_prev: number;
      visits_all_time: number;
    }>>`
      SELECT 
        COUNT(*) FILTER (WHERE "source" = 'QR_SCAN' AND "createdAt" >= ${startOfPeriod} AND "createdAt" <= ${endOfPeriod})::integer AS scans_current,
        COUNT(*) FILTER (WHERE "source" = 'QR_SCAN' AND "createdAt" >= ${startOfPrevPeriod} AND "createdAt" <= ${endOfPrevPeriod})::integer AS scans_prev,
        COUNT(*) FILTER (WHERE "source" = 'QR_SCAN')::integer AS scans_all_time,
        COUNT(*) FILTER (WHERE "createdAt" >= ${startOfPeriod} AND "createdAt" <= ${endOfPeriod})::integer AS visits_current,
        COUNT(*) FILTER (WHERE "createdAt" >= ${startOfPrevPeriod} AND "createdAt" <= ${endOfPrevPeriod})::integer AS visits_prev,
        COUNT(*)::integer AS visits_all_time
      FROM "TagVisit";
    `,

    // 13. Converted Visits
    prisma.$queryRaw<Array<{
      converted_current: number;
      converted_prev: number;
      converted_all_time: number;
    }>>`
      SELECT
        COUNT(DISTINCT v."visitId") FILTER (
          WHERE v."createdAt" >= ${startOfPeriod} AND v."createdAt" <= ${endOfPeriod}
            AND s."id" IS NOT NULL
        )::integer AS converted_current,
        COUNT(DISTINCT v."visitId") FILTER (
          WHERE v."createdAt" >= ${startOfPrevPeriod} AND v."createdAt" <= ${endOfPrevPeriod}
            AND s."id" IS NOT NULL
        )::integer AS converted_prev,
        COUNT(DISTINCT v."visitId") FILTER (
          WHERE s."id" IS NOT NULL
        )::integer AS converted_all_time
      FROM "TagVisit" v
      LEFT JOIN "CommunicationSession" s ON v."visitId" = s."visitId";
    `,

    // 14. Call Stats (Unifying exclusion: if !includeTest, only real calls to tagged resources)
    prisma.$queryRaw<Array<{
      initiated_current: number;
      initiated_prev: number;
      initiated_all_time: number;
      connected_current: number;
      connected_prev: number;
      connected_all_time: number;
      missed_current: number;
      missed_prev: number;
      missed_all_time: number;
      owners_current: number;
      owners_prev: number;
      owners_all_time: number;
    }>>`
      SELECT
        COUNT(*) FILTER (WHERE c."createdAt" >= ${startOfPeriod} AND c."createdAt" <= ${endOfPeriod})::integer AS initiated_current,
        COUNT(*) FILTER (WHERE c."createdAt" >= ${startOfPrevPeriod} AND c."createdAt" <= ${endOfPrevPeriod})::integer AS initiated_prev,
        COUNT(*)::integer AS initiated_all_time,

        COUNT(*) FILTER (WHERE (c."status" = 'CONNECTED' OR c."status" = 'COMPLETED') AND (c."durationSec" > 0 OR c."connectedAt" IS NOT NULL) AND c."createdAt" >= ${startOfPeriod} AND c."createdAt" <= ${endOfPeriod})::integer AS connected_current,
        COUNT(*) FILTER (WHERE (c."status" = 'CONNECTED' OR c."status" = 'COMPLETED') AND (c."durationSec" > 0 OR c."connectedAt" IS NOT NULL) AND c."createdAt" >= ${startOfPrevPeriod} AND c."createdAt" <= ${endOfPrevPeriod})::integer AS connected_prev,
        COUNT(*) FILTER (WHERE (c."status" = 'CONNECTED' OR c."status" = 'COMPLETED') AND (c."durationSec" > 0 OR c."connectedAt" IS NOT NULL))::integer AS connected_all_time,

        COUNT(*) FILTER (WHERE c."status" = 'MISSED' AND c."createdAt" >= ${startOfPeriod} AND c."createdAt" <= ${endOfPeriod})::integer AS missed_current,
        COUNT(*) FILTER (WHERE c."status" = 'MISSED' AND c."createdAt" >= ${startOfPrevPeriod} AND c."createdAt" <= ${endOfPrevPeriod})::integer AS missed_prev,
        COUNT(*) FILTER (WHERE c."status" = 'MISSED')::integer AS missed_all_time,

        COUNT(DISTINCT r."userId") FILTER (WHERE (c."status" = 'CONNECTED' OR c."status" = 'COMPLETED') AND (c."durationSec" > 0 OR c."connectedAt" IS NOT NULL) AND c."createdAt" >= ${startOfPeriod} AND c."createdAt" <= ${endOfPeriod})::integer AS owners_current,
        COUNT(DISTINCT r."userId") FILTER (WHERE (c."status" = 'CONNECTED' OR c."status" = 'COMPLETED') AND (c."durationSec" > 0 OR c."connectedAt" IS NOT NULL) AND c."createdAt" >= ${startOfPrevPeriod} AND c."createdAt" <= ${endOfPrevPeriod})::integer AS owners_prev,
        COUNT(DISTINCT r."userId") FILTER (WHERE (c."status" = 'CONNECTED' OR c."status" = 'COMPLETED') AND (c."durationSec" > 0 OR c."connectedAt" IS NOT NULL))::integer AS owners_all_time
      FROM "CommunicationCall" c
      JOIN "CommunicationSession" s ON c."sessionId" = s."id"
      JOIN "Resource" r ON s."resourceId" = r."id"
      LEFT JOIN "QrTag" t ON t."resourceId" = r."id"
      LEFT JOIN "User" u ON r."userId" = u."id"
      WHERE (${includeTest} = true OR (t."id" IS NOT NULL AND u."name" != 'Abrar test'));
    `,

    // 15. Call Cost Stats in Current Period
    prisma.$queryRaw<Array<{
      connected_calls: number;
      tags_with_calls: number;
      billable_minutes: number;
      attributed_billable_minutes: number;
    }>>`
      SELECT
        COUNT(c."id")::integer AS connected_calls,
        COUNT(DISTINCT t."id")::integer AS tags_with_calls,
        COALESCE(SUM(
          GREATEST(1, CEIL(COALESCE(c."durationSec", EXTRACT(EPOCH FROM (c."endedAt" - c."connectedAt")), 0)::float / 60.0))
        ), 0)::integer AS billable_minutes,
        COALESCE(SUM(
          CASE WHEN t."id" IS NOT NULL THEN
            GREATEST(1, CEIL(COALESCE(c."durationSec", EXTRACT(EPOCH FROM (c."endedAt" - c."connectedAt")), 0)::float / 60.0))
          ELSE 0 END
        ), 0)::integer AS attributed_billable_minutes
      FROM "CommunicationCall" c
      JOIN "CommunicationSession" s ON c."sessionId" = s."id"
      JOIN "Resource" r ON s."resourceId" = r."id"
      LEFT JOIN "QrTag" t ON t."resourceId" = r."id"
      LEFT JOIN "User" u ON r."userId" = u."id"
      WHERE c."status" IN ('CONNECTED', 'COMPLETED')
        AND (c."durationSec" > 0 OR c."connectedAt" IS NOT NULL)
        AND c."createdAt" >= ${startOfPeriod} AND c."createdAt" <= ${endOfPeriod}
        AND (${includeTest} = true OR (t."id" IS NOT NULL AND u."name" != 'Abrar test'));
    `,

    // 16. All-Time Call Cost (consistent exclusion)
    prisma.$queryRaw<Array<{ all_time_billable_minutes: number }>>`
      SELECT
        COALESCE(SUM(
          GREATEST(1, CEIL(COALESCE(c."durationSec", EXTRACT(EPOCH FROM (c."endedAt" - c."connectedAt")), 0)::float / 60.0))
        ), 0)::integer AS all_time_billable_minutes
      FROM "CommunicationCall" c
      JOIN "CommunicationSession" s ON c."sessionId" = s."id"
      JOIN "Resource" r ON s."resourceId" = r."id"
      LEFT JOIN "QrTag" t ON t."resourceId" = r."id"
      LEFT JOIN "User" u ON r."userId" = u."id"
      WHERE c."status" IN ('CONNECTED', 'COMPLETED')
        AND (c."durationSec" > 0 OR c."connectedAt" IS NOT NULL)
        AND (${includeTest} = true OR (t."id" IS NOT NULL AND u."name" != 'Abrar test'));
    `,

    // 17. Top 5 Tags by Call Cost in Period
    prisma.$queryRaw<Array<{
      tag_short_code: string;
      calls: number;
      billable_minutes: number;
    }>>`
      SELECT 
        t."tagNumber" AS tag_short_code,
        COUNT(c."id")::integer AS calls,
        COALESCE(SUM(
          GREATEST(1, CEIL(COALESCE(c."durationSec", EXTRACT(EPOCH FROM (c."endedAt" - c."connectedAt")), 0)::float / 60.0))
        ), 0)::integer AS billable_minutes
      FROM "CommunicationCall" c
      JOIN "CommunicationSession" s ON c."sessionId" = s."id"
      JOIN "Resource" r ON s."resourceId" = r."id"
      JOIN "QrTag" t ON t."resourceId" = r."id"
      WHERE c."status" IN ('CONNECTED', 'COMPLETED')
        AND (c."durationSec" > 0 OR c."connectedAt" IS NOT NULL)
        AND c."createdAt" >= ${startOfPeriod} AND c."createdAt" <= ${endOfPeriod}
      GROUP BY t."tagNumber"
      ORDER BY billable_minutes DESC
      LIMIT 5;
    `,

    // 18. Activation: Delivered Tags
    prisma.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(DISTINCT a."qrTagId")::integer AS count
      FROM "OrderTagAllocation" a
      JOIN "Order" o ON a."orderId" = o."id"
      WHERE o."status" = 'DELIVERED';
    `,

    // 19. Activation: Tags Linked to Vehicles
    prisma.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*)::integer AS count FROM "QrTag" WHERE "status" = 'ASSIGNED';
    `,

    // 20. Activation: Tags that Received at least one call
    prisma.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(DISTINCT t."id")::integer AS count
      FROM "QrTag" t
      JOIN "CommunicationSession" s ON s."resourceId" = t."resourceId";
    `,

    // 21. Activation: Median Days Delivery to Linking
    prisma.$queryRaw<Array<{ median_days: number | null }>>`
      SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (
        ORDER BY EXTRACT(EPOCH FROM (t."assignedAt" - o."deliveredAt")) / 86400.0
      )::float AS median_days
      FROM "OrderTagAllocation" a
      JOIN "Order" o ON a."orderId" = o."id"
      JOIN "QrTag" t ON a."qrTagId" = t."id"
      WHERE o."deliveredAt" IS NOT NULL 
        AND t."assignedAt" IS NOT NULL 
        AND t."assignedAt" >= o."deliveredAt";
    `,

    // 22. Plus: Active Plus by Source
    prisma.$queryRaw<Array<{ source: string; count: number }>>`
      SELECT 
        COALESCE("source", 'included_with_order') AS source,
        COUNT(*)::integer AS count
      FROM "Subscription" s
      JOIN "User" u ON s."userId" = u."id"
      WHERE s."tier" = 'PLUS' 
        AND (s."expiresAt" IS NULL OR s."expiresAt" > NOW())
        AND (${includeTest} = true OR u."name" != 'Abrar test')
      GROUP BY COALESCE("source", 'included_with_order');
    `,

    // 23. Plus: Pending Grants (Awaiting pairing or guest claim)
    prisma.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*)::integer AS count
      FROM "SubscriptionGrant"
      WHERE "status" IN ('PENDING_CLAIM', 'PENDING_PAIRING');
    `,

    // 24. Plus: Expiring in Next 30 Days
    prisma.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*)::integer AS count
      FROM "Subscription" s
      JOIN "User" u ON s."userId" = u."id"
      WHERE s."tier" = 'PLUS'
        AND s."expiresAt" IS NOT NULL
        AND s."expiresAt" > NOW()
        AND s."expiresAt" <= NOW() + INTERVAL '30 days'
        AND (${includeTest} = true OR u."name" != 'Abrar test');
    `,

    // 25. Plus: Next Expiry Date
    prisma.$queryRaw<Array<{ next_expiry: Date | null }>>`
      SELECT MIN(s."expiresAt") AS next_expiry
      FROM "Subscription" s
      JOIN "User" u ON s."userId" = u."id"
      WHERE s."tier" = 'PLUS'
        AND s."expiresAt" > NOW()
        AND (${includeTest} = true OR u."name" != 'Abrar test');
    `,
  ]);

  // -------------------------------------------------------------
  // Process Sales & Pipeline
  // -------------------------------------------------------------
  const sRow = salesRows[0] || {
    unpaid_count: 0,
    unpaid_value: 0,
    to_pack_count: 0,
    to_pack_value: 0,
    packing_count: 0,
    packing_value: 0,
    delivered_count: 0,
    delivered_value: 0,
    cancelled_refunded_count: 0,
    cancelled_refunded_value: 0,
    prev_paid_orders: 0,
    prev_revenue: 0,
  };

  const toPackCount = Number(sRow.to_pack_count);
  const toPackValue = Number(sRow.to_pack_value);
  const packingCount = Number(sRow.packing_count);
  const packingValue = Number(sRow.packing_value);
  const deliveredCount = Number(sRow.delivered_count);
  const deliveredValue = Number(sRow.delivered_value);
  const unpaidCount = Number(sRow.unpaid_count);
  const unpaidValue = Number(sRow.unpaid_value);
  const cancelledRefundedCount = Number(sRow.cancelled_refunded_count);
  const cancelledRefundedValue = Number(sRow.cancelled_refunded_value);

  const revenuePaise = toPackValue + packingValue + deliveredValue;
  const paidOrders = toPackCount + packingCount + deliveredCount;
  const checkoutsStarted = unpaidCount + toPackCount + packingCount + deliveredCount + cancelledRefundedCount;
  const salesConversion = checkoutsStarted > 0 ? Number(((paidOrders / checkoutsStarted) * 100).toFixed(1)) : null;

  const sales: OverviewSalesMetrics = {
    revenuePaise,
    paidOrders,
    checkoutsStarted,
    conversionPercent: salesConversion,
    previous: {
      revenuePaise: Number(sRow.prev_revenue),
      paidOrders: Number(sRow.prev_paid_orders),
    },
    pipeline: {
      unpaid: { count: unpaidCount, valuePaise: unpaidValue },
      toPack: { count: toPackCount, valuePaise: toPackValue },
      packing: { count: packingCount, valuePaise: packingValue },
      delivered: { count: deliveredCount, valuePaise: deliveredValue },
      cancelledRefunded: { count: cancelledRefundedCount, valuePaise: cancelledRefundedValue },
    },
  };

  // -------------------------------------------------------------
  // Process Fulfilment & Store-Facing Packs Available
  // -------------------------------------------------------------
  const waitingCount = waitingOrders.length;
  const waitingValue = waitingOrders.reduce((acc, o) => acc + o.totalAmount, 0);
  const oldestWaitingAt = waitingOrders[0]?.createdAt ? waitingOrders[0].createdAt.toISOString() : null;
  const waitingOrderRefs = waitingOrders.map((o) => o.orderNumber);

  // Group by customer-facing store products (Pair, Complete set, Extra stickers, Keychains, Mini stickers)
  const skuStockMap = new Map(inventorySummary.serializedBySku.map((s) => [s.sku, s.sellableStock]));
  const storeProductMap = new Map<
    string,
    {
      productId: string;
      name: string;
      packs: number;
      variants: Array<{ variantId: string; name: string; packs: number }>;
    }
  >();

  for (const product of catalogProducts) {
    for (const variant of product.variants) {
      const tagComponents = variant.components.filter(
        (c) => c.componentType === "SERIALIZED_QR_TAG" && c.inventorySku
      );
      if (tagComponents.length === 0) continue;

      let maxPacks = Infinity;
      for (const tc of tagComponents) {
        const avail = skuStockMap.get(tc.inventorySku!) || 0;
        const possible = Math.floor(avail / tc.quantity);
        if (possible < maxPacks) maxPacks = possible;
      }
      const variantPacks = maxPacks === Infinity ? 0 : maxPacks;

      const { storeName, category } = mapToStoreProductName(product.name, variant.sku);
      let entry = storeProductMap.get(category);
      if (!entry) {
        entry = {
          productId: category,
          name: storeName,
          packs: 0,
          variants: [],
        };
        storeProductMap.set(category, entry);
      }

      entry.packs += variantPacks;
      const variantDisplayName =
        variant.name && variant.name !== "Standard Pack"
          ? variant.name
          : variant.sku.includes("DRK")
          ? "Dark"
          : "Light";

      entry.variants.push({
        variantId: variant.sku,
        name: variantDisplayName,
        packs: variantPacks,
      });
    }
  }

  // Pre-determined order for store presentation
  const preferredOrder = ["pair", "complete_set", "stickers", "keychains", "mini_stickers"];
  const packsAvailable: PackAvailable[] = [];
  for (const cat of preferredOrder) {
    const p = storeProductMap.get(cat);
    if (p) packsAvailable.push(p);
  }
  for (const [cat, p] of storeProductMap.entries()) {
    if (!preferredOrder.includes(cat)) packsAvailable.push(p);
  }

  const lowStockSkus = inventorySummary.serializedBySku.filter(
    (s) => !OVERVIEW_CONFIG.legacySkus.includes(s.sku) && s.sellableStock <= OVERVIEW_CONFIG.lowStockReorderThreshold
  );
  const lowStockCount = lowStockSkus.length;

  const fulfilment: OverviewFulfilmentMetrics = {
    waitingForTags: {
      count: waitingCount,
      valuePaise: waitingValue,
      oldestAt: oldestWaitingAt,
      targetHours: OVERVIEW_CONFIG.waitingForTagsTargetHours,
      orderRefs: waitingOrderRefs,
    },
    packsAvailable,
    lowStockCount,
  };

  // -------------------------------------------------------------
  // Process Attention Queue
  // -------------------------------------------------------------
  const attention: AttentionItem[] = [];

  // 1. Waiting for tags (target 2 days = 48 hours)
  if (waitingCount > 0 && oldestWaitingAt) {
    const ageHours = (now.getTime() - new Date(oldestWaitingAt).getTime()) / (3600 * 1000);
    const isLate = ageHours > OVERVIEW_CONFIG.waitingForTagsTargetHours;
    attention.push({
      id: "waiting_for_tags",
      kind: "waiting_for_tags",
      count: waitingCount,
      valuePaise: waitingValue,
      oldestAt: oldestWaitingAt,
      targetHours: OVERVIEW_CONFIG.waitingForTagsTargetHours,
      late: isLate,
      refs: waitingOrderRefs,
      route: "/admin/orders?status=PAID",
    });
  }

  // 2. Unpaid checkouts with pending payment (target 24 hours)
  if (unpaidOrders.length > 0) {
    const oldestUnpaid = unpaidOrders[0];
    const oldestUnpaidAt = oldestUnpaid?.createdAt ? oldestUnpaid.createdAt.toISOString() : null;
    const unpaidAgeHours = oldestUnpaidAt ? (now.getTime() - new Date(oldestUnpaidAt).getTime()) / (3600 * 1000) : 0;
    attention.push({
      id: "unpaid_checkouts",
      kind: "unpaid_checkouts",
      count: unpaidOrders.length,
      valuePaise: unpaidOrders.reduce((acc, o) => acc + o.totalAmount, 0),
      oldestAt: oldestUnpaidAt,
      targetHours: OVERVIEW_CONFIG.unpaidCheckoutTargetHours,
      late: unpaidAgeHours > OVERVIEW_CONFIG.unpaidCheckoutTargetHours,
      refs: unpaidOrders.map((o) => o.orderNumber),
      route: "/admin/orders?status=PAYMENT_PENDING",
    });
  }

  // 3. Late shipments (target 7 days = 168 hours)
  const sevenDaysAgo = new Date(now.getTime() - OVERVIEW_CONFIG.lateShipmentTargetHours * 3600 * 1000);
  const lateShipmentOrders = await prisma.order.findMany({
    where: {
      status: { in: ["PAID", "PACKING", "PACKED"] },
      createdAt: { lt: sevenDaysAgo },
      ...(includeTest
        ? {}
        : {
            OR: [
              { customerEmail: null },
              { customerEmail: { notIn: OVERVIEW_CONFIG.testCustomerEmails } },
            ],
          }),
    },
    select: { orderNumber: true, totalAmount: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  if (lateShipmentOrders.length > 0) {
    attention.push({
      id: "late_shipment",
      kind: "late_shipment",
      count: lateShipmentOrders.length,
      valuePaise: lateShipmentOrders.reduce((acc, o) => acc + o.totalAmount, 0),
      oldestAt: lateShipmentOrders[0]?.createdAt ? lateShipmentOrders[0].createdAt.toISOString() : null,
      targetHours: OVERVIEW_CONFIG.lateShipmentTargetHours,
      late: true,
      refs: lateShipmentOrders.map((o) => o.orderNumber),
      route: "/admin/orders?status=PACKED",
    });
  }

  // 4. Low stock inventory warnings
  for (const ls of lowStockSkus) {
    attention.push({
      id: `low_stock_${ls.sku}`,
      kind: "low_stock",
      count: ls.sellableStock,
      valuePaise: null,
      oldestAt: null,
      targetHours: null,
      late: ls.sellableStock === 0,
      refs: [ls.sku],
      route: "/admin/inventory",
    });
  }

  // 5. Job errors in last 24h
  const [edesyLast, webhookLast, paymentLast, jobErrors24h] = healthResults;
  if (jobErrors24h > 0) {
    attention.push({
      id: "job_errors",
      kind: "job_errors",
      count: jobErrors24h,
      valuePaise: null,
      oldestAt: null,
      targetHours: null,
      late: true,
      refs: [],
      route: "/admin/system",
    });
  }

  attention.sort((a, b) => {
    if (a.late !== b.late) return a.late ? -1 : 1;
    if (a.valuePaise != null && b.valuePaise != null) return b.valuePaise - a.valuePaise;
    return b.count - a.count;
  });
  const limitedAttention = attention.slice(0, 10);

  // -------------------------------------------------------------
  // Process System Health
  // -------------------------------------------------------------
  const lastPaymentCallback = webhookLast?.receivedAt || paymentLast?.createdAt || null;
  const health: OverviewHealthMetrics = {
    callProvider: {
      lastEventAt: edesyLast?.receivedAt ? edesyLast.receivedAt.toISOString() : null,
    },
    payments: {
      lastCallbackAt: lastPaymentCallback ? new Date(lastPaymentCallback).toISOString() : null,
    },
    jobs: {
      errors24h: jobErrors24h,
    },
  };

  // -------------------------------------------------------------
  // Process Activity Feed (Max 8 Events, Real Event Types)
  // -------------------------------------------------------------
  const activityEvents: OverviewActivityEvent[] = [];

  // order_paid events
  for (const o of recentPaidOrders) {
    let firstName: string | null = null;
    if (o.shippingAddress?.fullName) {
      try {
        const decrypted = decryptData(o.shippingAddress.fullName);
        firstName = decrypted.trim().split(/\s+/)[0] || null;
      } catch {
        firstName = null;
      }
    } else if (o.user?.name) {
      firstName = o.user.name.trim().split(/\s+/)[0] || null;
    }
    const storeNames = o.items
      .map((i) => mapToStoreProductName(i.variant.product.name, i.variant.sku).storeName)
      .join(", ");

    activityEvents.push({
      at: o.createdAt.toISOString(),
      type: "order_paid",
      ref: o.orderNumber,
      customerFirstName: firstName,
      summary: `Order paid: ${storeNames || "Items"}`,
      amountPaise: o.totalAmount,
      durationSec: null,
      outcome: o.status,
      groupedCount: null,
    });
  }

  // order_delivered events (grouped if multiple delivered)
  if (recentDeliveredOrders.length > 0) {
    const totalDeliveredValue = recentDeliveredOrders.reduce((acc, o) => acc + o.totalAmount, 0);
    const latestDelivered = recentDeliveredOrders[0]!;
    activityEvents.push({
      at: (latestDelivered.updatedAt || latestDelivered.createdAt).toISOString(),
      type: "order_delivered",
      ref: latestDelivered.orderNumber,
      customerFirstName: null,
      summary: `${recentDeliveredOrders.length} orders delivered`,
      amountPaise: totalDeliveredValue,
      durationSec: null,
      outcome: "DELIVERED",
      groupedCount: recentDeliveredOrders.length,
    });
  }

  // call events (tag short code only, duration and outcome)
  for (const c of recentCalls) {
    const tag = c.session?.resource?.qrTag?.[0];
    if (!tag) continue;
    activityEvents.push({
      at: c.createdAt.toISOString(),
      type: "call",
      ref: tag.tagNumber,
      customerFirstName: null,
      summary: c.durationSec ? `Connected call (${c.durationSec}s)` : `Missed call`,
      amountPaise: null,
      durationSec: c.durationSec,
      outcome: c.status,
      groupedCount: null,
    });
  }

  // tag_linked events
  for (const a of recentAssignments) {
    const tagCode = a.qrTag?.tagNumber;
    if (!tagCode) continue;
    let ownerFirstName: string | null = null;
    if (a.resource?.user?.name) {
      ownerFirstName = a.resource.user.name.trim().split(/\s+/)[0] || null;
    }
    activityEvents.push({
      at: a.assignedAt.toISOString(),
      type: "tag_linked",
      ref: tagCode,
      customerFirstName: ownerFirstName,
      summary: `Tag ${tagCode} linked to vehicle`,
      amountPaise: null,
      durationSec: null,
      outcome: "LINKED",
      groupedCount: null,
    });
  }

  activityEvents.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  const limitedActivity = activityEvents.slice(0, 8);

  // -------------------------------------------------------------
  // Process Lifetime Metrics
  // -------------------------------------------------------------
  const [lifetimeUsers, lifetimeRegisteredTags, lifetimeTagsMade] = lifetimeResults;
  const lifetime: OverviewLifetimeMetrics = {
    users: lifetimeUsers,
    registeredTags: lifetimeRegisteredTags,
    tagsMade: lifetimeTagsMade,
  };

  // -------------------------------------------------------------
  // Process Usage Metrics
  // -------------------------------------------------------------
  const v = visitRows[0] || {
    scans_current: 0,
    scans_prev: 0,
    scans_all_time: 0,
    visits_current: 0,
    visits_prev: 0,
    visits_all_time: 0,
  };

  const conv = convertedVisitRows[0] || {
    converted_current: 0,
    converted_prev: 0,
    converted_all_time: 0,
  };

  const c = callRows[0] || {
    initiated_current: 0,
    initiated_prev: 0,
    initiated_all_time: 0,
    connected_current: 0,
    connected_prev: 0,
    connected_all_time: 0,
    missed_current: 0,
    missed_prev: 0,
    missed_all_time: 0,
    owners_current: 0,
    owners_prev: 0,
    owners_all_time: 0,
  };

  const currentUsageConversion = computeVisitConversion(conv.converted_current, v.visits_current);
  const prevUsageConversion = computeVisitConversion(conv.converted_prev, v.visits_prev);
  const allTimeUsageConversion = computeVisitConversion(conv.converted_all_time, v.visits_all_time);

  const usage: OverviewUsageMetrics = {
    isApproximate: true,
    currentPeriod: {
      scans: v.scans_current,
      contactPageVisits: v.visits_current,
      callsInitiated: c.initiated_current,
      callsConnected: c.connected_current,
      callsMissed: c.missed_current,
      ownersReached: c.owners_current,
      conversionPercent: currentUsageConversion,
    },
    previousPeriod: {
      scans: v.scans_prev,
      contactPageVisits: v.visits_prev,
      callsInitiated: c.initiated_prev,
      callsConnected: c.connected_prev,
      callsMissed: c.missed_prev,
      ownersReached: c.owners_prev,
      conversionPercent: prevUsageConversion,
    },
    allTime: {
      scans: v.scans_all_time,
      contactPageVisits: v.visits_all_time,
      callsInitiated: c.initiated_all_time,
      callsConnected: c.connected_all_time,
      callsMissed: c.missed_all_time,
      ownersReached: c.owners_all_time,
      conversionPercent: allTimeUsageConversion,
    },
  };

  // -------------------------------------------------------------
  // Process Call Cost & Attribution
  // -------------------------------------------------------------
  const cost = costRows[0] || {
    connected_calls: 0,
    tags_with_calls: 0,
    billable_minutes: 0,
    attributed_billable_minutes: 0,
  };

  const totalBillableMinutes = cost.billable_minutes;
  const estimatedCostPaise = Math.round(totalBillableMinutes * OVERVIEW_CONFIG.callRatePerMinutePaise);
  const attributedToTagsPaise = Math.round(cost.attributed_billable_minutes * OVERVIEW_CONFIG.callRatePerMinutePaise);
  const unattributedPaise = Math.max(0, estimatedCostPaise - attributedToTagsPaise);

  const allTimeMinutes = allTimeCostRows[0]?.all_time_billable_minutes ?? 0;
  const allTimeCostPaise = Math.round(allTimeMinutes * OVERVIEW_CONFIG.callRatePerMinutePaise);

  const periodConnectedCalls = cost.connected_calls;
  const periodTagsWithCalls = cost.tags_with_calls;

  const averageCostPerConnectedCallPaise =
    periodConnectedCalls > 0 ? Math.round(estimatedCostPaise / periodConnectedCalls) : null;

  const costPerTagWithCallsPaise =
    periodTagsWithCalls > 0 ? Math.round(attributedToTagsPaise / periodTagsWithCalls) : null;

  const baseBothLegsPaise = totalBillableMinutes * OVERVIEW_CONFIG.callBillingLegs * OVERVIEW_CONFIG.callRatePerMinutePaise;
  const estimatedWithProviderBillingPaise = Math.round(baseBothLegsPaise * (1 + OVERVIEW_CONFIG.gstPercent / 100));

  const top5TagsByCost: TopTagCost[] = (topTagRows || []).map((t) => ({
    tagShortCode: t.tag_short_code,
    calls: t.calls,
    billableMinutes: t.billable_minutes,
    costPaise: Math.round(t.billable_minutes * OVERVIEW_CONFIG.callRatePerMinutePaise),
  }));

  const callCost: OverviewCallCostMetrics = {
    ratePerMinutePaise: OVERVIEW_CONFIG.callRatePerMinutePaise,
    totalBillableMinutes,
    estimatedCostPaise,
    allTimeCostPaise,
    attributedToTagsPaise,
    unattributedPaise,
    averageCostPerConnectedCallPaise,
    costPerTagWithCallsPaise,
    durationSource: "provider",
    config: {
      legs: OVERVIEW_CONFIG.callBillingLegs,
      gstPercent: OVERVIEW_CONFIG.gstPercent,
    },
    estimatedWithProviderBillingPaise,
    top5TagsByCost,
  };

  // -------------------------------------------------------------
  // Process Activation & Plus
  // -------------------------------------------------------------
  const medianDaysRaw = medianDaysRows[0]?.median_days;
  const medianDaysDeliveryToLinking =
    medianDaysRaw != null ? Number(medianDaysRaw.toFixed(1)) : null;

  if (medianDaysDeliveryToLinking === null) {
    unavailable.push("activation.medianDaysDeliveryToLinking");
  }

  const activation: OverviewActivationMetrics = {
    deliveredTags: deliveredTagsRows[0]?.count ?? 0,
    tagsLinkedToVehicles: linkedTagsRows[0]?.count ?? 0,
    tagsWithAtLeastOneCall: tagsWithCallsRows[0]?.count ?? 0,
    medianDaysDeliveryToLinking,
  };

  const activePlusMap: Record<string, number> = {
    included_with_order: 0,
    paid: 0,
    admin_grant: 0,
  };

  let totalActivePlus = 0;
  for (const row of plusBySourceRows || []) {
    const src = row.source || "included_with_order";
    activePlusMap[src] = (activePlusMap[src] || 0) + row.count;
    totalActivePlus += row.count;
  }

  const plus: OverviewPlusMetrics = {
    activePlusBySource: {
      included_with_order: activePlusMap.included_with_order || 0,
      paid: activePlusMap.paid || 0,
      admin_grant: activePlusMap.admin_grant || 0,
      totalActivePlus,
    },
    pendingGrants: pendingGrantsRows[0]?.count ?? 0,
    expiringInNext30Days: plusExpiring30dRows[0]?.count ?? 0,
    nextExpiryDate: nextExpiryRows[0]?.next_expiry
      ? new Date(nextExpiryRows[0].next_expiry).toISOString()
      : null,
  };

  const consolidatedTagCounts: ConsolidatedTagCounts = {
    readyToSell: inventorySummary.totals.totalSellableStock,
    inUse: inventorySummary.totals.assignedToVehicles,
    inWarehouse: inventorySummary.totals.physicalStock,
    reserved: inventorySummary.totals.totalCommittedDemand,
    totalPhysicalTags: inventorySummary.totals.totalPhysicalTags,
  };

  const meta: OverviewMeta = {
    tz: "Asia/Kolkata",
    period,
    range: {
      start: startOfPeriod.toISOString(),
      end: endOfPeriod.toISOString(),
    },
    previousRange: {
      start: startOfPrevPeriod.toISOString(),
      end: endOfPrevPeriod.toISOString(),
    },
    generatedAt: now.toISOString(),
    cached: false,
    excludesTestData: !includeTest,
  };

  const response: AdminOverviewResponse = {
    meta,
    sales,
    fulfilment,
    attention: limitedAttention,
    health,
    activity: limitedActivity,
    lifetime,
    usage,
    callCost,
    activation,
    plus,
    consolidatedTagCounts,
    unavailable,
  };

  cache.set(cacheKey, {
    data: response,
    expiresAt: nowMs + CACHE_TTL_MS,
  });

  return response;
}
