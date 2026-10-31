import { prisma } from "../../../lib/prisma.js";
import { getTelephonyPricing, resolveEffectiveCostPaise } from "../../../config/telephony.config.js";

export type TelephonyPeriod =
  | "this_month"
  | "last_month"
  | "last_30d"
  | "all_time"
  | "month"
  | "today"
  | "7d"
  | "30d"
  | "all";

export interface TelephonyAnalyticsQuery {
  period?: TelephonyPeriod;
  provider?: string;
}

/**
 * Calculates start and end Date boundaries for the requested period in Asia/Kolkata (IST).
 */
export function getTelephonyPeriodRange(period: string = "this_month", referenceTime = new Date()): {
  name: "this_month" | "last_month" | "last_30d" | "all_time";
  label: string;
  startsAt: Date;
  endsAt: Date;
} {
  const now = referenceTime;
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const istTime = new Date(now.getTime() + istOffsetMs);
  const istYear = istTime.getUTCFullYear();
  const istMonth = istTime.getUTCMonth();
  const istDate = istTime.getUTCDate();

  // Midnight today in IST (UTC representation)
  const todayStartIstUtc = new Date(Date.UTC(istYear, istMonth, istDate) - istOffsetMs);

  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];

  const normalized = period.toLowerCase().trim();

  // 1. Last Month
  if (normalized === "last_month" || normalized === "previous_month") {
    const prevMonthYear = istMonth === 0 ? istYear - 1 : istYear;
    const prevMonth = istMonth === 0 ? 11 : istMonth - 1;
    const startOfPrevMonthUtc = new Date(Date.UTC(prevMonthYear, prevMonth, 1) - istOffsetMs);
    const startOfCurrentMonthUtc = new Date(Date.UTC(istYear, istMonth, 1) - istOffsetMs);
    const endOfPrevMonthUtc = new Date(startOfCurrentMonthUtc.getTime() - 1);

    return {
      name: "last_month",
      label: `Last Month (${monthNames[prevMonth]} ${prevMonthYear})`,
      startsAt: startOfPrevMonthUtc,
      endsAt: endOfPrevMonthUtc,
    };
  }

  // 2. Last 30 Days
  if (normalized === "last_30d" || normalized === "30d") {
    const startsAt = new Date(todayStartIstUtc.getTime() - 29 * 24 * 60 * 60 * 1000);
    return {
      name: "last_30d",
      label: "Last 30 Days",
      startsAt,
      endsAt: now,
    };
  }

  // 3. All Time
  if (normalized === "all_time" || normalized === "all") {
    return {
      name: "all_time",
      label: "All Time",
      startsAt: new Date(0),
      endsAt: now,
    };
  }

  // 4. Default: This Month
  const startOfCurrentMonthUtc = new Date(Date.UTC(istYear, istMonth, 1) - istOffsetMs);
  return {
    name: "this_month",
    label: `This Month (${monthNames[istMonth]} ${istYear})`,
    startsAt: startOfCurrentMonthUtc,
    endsAt: now,
  };
}

function formatDurationSeconds(sec: number): string {
  if (!sec && sec !== 0) return "0m 0s";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}m ${s}s`;
}

/**
 * Reconciled admin telephony analytics:
 * Restructured strictly around three distinct sections:
 * A. Usage
 * B. Financials
 * C. Usage limits
 */
export const getAdminTelephonyAnalytics = async (query: TelephonyAnalyticsQuery = {}) => {
  const periodRange = getTelephonyPeriodRange(query.period || "this_month");
  const providerName = (query.provider || "EDESY").toUpperCase();
  const pricingConfig = getTelephonyPricing(providerName);

  const { startsAt, endsAt } = periodRange;
  const now = new Date();

  // 1. Fetch all calls with underlying CommunicationSession and Resource relationships for complete reconciliation
  const [calls, totalSessionsCount] = await Promise.all([
    prisma.communicationCall.findMany({
      where: {
        createdAt: {
          gte: startsAt,
          lte: endsAt,
        },
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
          },
        },
        resource: {
          select: {
            id: true,
            name: true,
            userId: true,
            user: { select: { id: true, name: true } },
          },
        },
        session: {
          include: {
            resource: {
              include: {
                user: { select: { id: true, name: true } },
              },
            },
          },
        },
        qrTag: {
          select: {
            id: true,
            tagNumber: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.communicationSession.count({
      where: {
        createdAt: {
          gte: startsAt,
          lte: endsAt,
        },
      },
    }),
  ]);

  // Aggregate A: Usage Metrics
  let totalCalls = calls.length;
  let connectedCalls = 0;
  let missedCalls = 0;
  let actualDurationSeconds = 0;
  let billedDurationSeconds = 0;
  let providerReportedCostPaise = 0;
  let estimatedCostPaise = 0;
  let effectiveCostPaise = 0;
  let callsExceeding10MinCount = 0;

  const connectedDurations: number[] = [];

  // User-level usage aggregation map for FUP and limits
  const userUsageMap = new Map<
    string,
    {
      userId: string;
      userName: string;
      totalCalls: number;
      connectedCalls: number;
      actualSeconds: number;
      billedSeconds: number;
      effectiveCostPaise: number;
    }
  >();

  for (const call of calls) {
    const isConnected =
      call.status === "CONNECTED" ||
      call.status === "COMPLETED" ||
      call.connectedAt != null;

    const actual =
      call.actualDurationSeconds > 0
        ? call.actualDurationSeconds
        : (call.durationSec ?? 0);

    if (isConnected) {
      connectedCalls++;
      actualDurationSeconds += actual;
      connectedDurations.push(actual);
      if (actual > 600) {
        callsExceeding10MinCount++;
      }
    } else {
      missedCalls++;
    }

    const billed =
      call.billedDurationSeconds > 0
        ? call.billedDurationSeconds
        : isConnected
        ? Math.ceil(Math.max(60, actual) / 60) * 60
        : 0;
    billedDurationSeconds += billed;

    if (call.providerCostPaise != null) {
      providerReportedCostPaise += call.providerCostPaise;
    }

    const est =
      call.estimatedCostPaise != null
        ? call.estimatedCostPaise
        : Math.ceil(billed / 60) *
          pricingConfig.ratePerMinutePaise *
          (1 + pricingConfig.gstRate / 100);
    estimatedCostPaise += est;

    const callEffCost = resolveEffectiveCostPaise({
      ...call,
      billedDurationSeconds: billed,
      estimatedCostPaise: call.estimatedCostPaise ?? est,
    });
    effectiveCostPaise += callEffCost;

    // Fully reconciled subscriber user identification across Call -> Resource -> Session -> User
    const targetUserId =
      call.userId ||
      call.resource?.userId ||
      call.session?.resource?.userId ||
      null;

    const targetUserName =
      call.user?.name ||
      call.resource?.user?.name ||
      call.session?.resource?.user?.name ||
      "Subscriber";

    if (targetUserId) {
      const existing = userUsageMap.get(targetUserId) || {
        userId: targetUserId,
        userName: targetUserName,
        totalCalls: 0,
        connectedCalls: 0,
        actualSeconds: 0,
        billedSeconds: 0,
        effectiveCostPaise: 0,
      };
      existing.totalCalls++;
      if (isConnected) existing.connectedCalls++;
      existing.actualSeconds += actual;
      existing.billedSeconds += billed;
      existing.effectiveCostPaise += callEffCost;
      userUsageMap.set(targetUserId, existing);
    }
  }

  // Duration calculations
  connectedDurations.sort((a, b) => a - b);
  const averageDurationSeconds =
    connectedCalls > 0 ? Math.round(actualDurationSeconds / connectedCalls) : 0;
  const longestCallSeconds =
    connectedDurations.length > 0 ? connectedDurations[connectedDurations.length - 1] ?? 0 : 0;
  const p50DurationSeconds =
    connectedDurations.length > 0
      ? connectedDurations[Math.floor(connectedDurations.length * 0.5)] ?? 0
      : 0;
  const p90DurationSeconds =
    connectedDurations.length > 0
      ? connectedDurations[Math.floor(connectedDurations.length * 0.9)] ?? 0
      : 0;
  const isWithin10MinCap = callsExceeding10MinCount === 0 && longestCallSeconds <= 600;

  // Aggregate B: Financials & Revenue Accounting
  const [activeSubscribers, purchases] = await Promise.all([
    prisma.subscription.count({
      where: {
        tier: "PLUS",
        expiresAt: { gt: now },
      },
    }),
    prisma.subscriptionPurchase.findMany({
      where: {
        createdAt: { gte: startsAt, lte: endsAt },
        status: { in: ["COMPLETED", "REFUNDED"] },
      },
      select: {
        status: true,
        amountPaise: true,
      },
    }),
  ]);

  let collectedRevenuePaise = 0;
  let refundedRevenuePaise = 0;
  for (const p of purchases) {
    if (p.status === "COMPLETED") collectedRevenuePaise += p.amountPaise;
    if (p.status === "REFUNDED") refundedRevenuePaise += p.amountPaise;
  }

  const grossRevenuePaise = Math.max(0, collectedRevenuePaise - refundedRevenuePaise);
  // Applicable GST (18% inclusive): price * 18/118
  const applicableGstPaise = Math.round(grossRevenuePaise * (18 / 118));
  // Gateway fees (~2.36% inclusive of GST on fee)
  const gatewayFeePaise = Math.round(grossRevenuePaise * 0.0236);
  // Net recognized subscription revenue
  const netRevenuePaise = grossRevenuePaise - applicableGstPaise - gatewayFeePaise;

  const grossContributionPaise = netRevenuePaise - effectiveCostPaise;
  const grossContributionRupees = grossContributionPaise / 100;
  const grossContributionMarginPercent =
    netRevenuePaise > 0
      ? Math.round((grossContributionPaise / netRevenuePaise) * 1000) / 10
      : null;

  const costPerActiveSubscriberPaise =
    activeSubscribers > 0 ? Math.round(effectiveCostPaise / activeSubscribers) : 0;
  const costPerActiveSubscriberRupees = costPerActiveSubscriberPaise / 100;

  // Aggregate C: Usage Limits & FUP Analysis
  const allUserAccounts = Array.from(userUsageMap.values());

  // 1. Users exceeding 5 minutes / 300 seconds
  const usersExceedingFup = allUserAccounts
    .filter((acc) => acc.actualSeconds > 300 || acc.billedSeconds > 300)
    .sort((a, b) => b.actualSeconds - a.actualSeconds)
    .map((acc) => ({
      userId: acc.userId,
      userName: acc.userName,
      totalCalls: acc.totalCalls,
      connectedCalls: acc.connectedCalls,
      actualMinutes: Math.round((acc.actualSeconds / 60) * 10) / 10,
      billedMinutes: Math.round(acc.billedSeconds / 60),
      effectiveCostRupees: acc.effectiveCostPaise / 100,
      excessMinutes: Math.max(0, Math.round(((acc.actualSeconds - 300) / 60) * 10) / 10),
    }));

  // 2. Users approaching 5 minutes (between 240 seconds and 300 seconds = 4m to 5m, 80-100% of FUP)
  const usersApproachingFup = allUserAccounts
    .filter((acc) => acc.actualSeconds >= 240 && acc.actualSeconds <= 300)
    .sort((a, b) => b.actualSeconds - a.actualSeconds)
    .map((acc) => ({
      userId: acc.userId,
      userName: acc.userName,
      totalCalls: acc.totalCalls,
      connectedCalls: acc.connectedCalls,
      actualMinutes: Math.round((acc.actualSeconds / 60) * 10) / 10,
      billedMinutes: Math.round(acc.billedSeconds / 60),
      effectiveCostRupees: acc.effectiveCostPaise / 100,
      remainingSeconds: Math.max(0, 300 - acc.actualSeconds),
    }));

  const totalMinutesConsumed = Math.round(billedDurationSeconds / 60);
  const totalActualMinutesConsumed = Math.round((actualDurationSeconds / 60) * 10) / 10;
  // Expected usage baseline: active subscribers * 5 minutes (minimum baseline floor of 25 min if 0 active)
  const expectedUsageMinutes = Math.max(25, activeSubscribers * 5);
  const consumptionRatioPercent =
    expectedUsageMinutes > 0
      ? Math.round((totalMinutesConsumed / expectedUsageMinutes) * 1000) / 10
      : null;

  return {
    period: {
      name: periodRange.name,
      label: periodRange.label,
      startsAt: periodRange.startsAt.toISOString(),
      endsAt: periodRange.endsAt.toISOString(),
    },

    // ─────────────────────────────────────────────────────────────────────────
    // SECTION A: USAGE
    // ─────────────────────────────────────────────────────────────────────────
    usage: {
      totalCalls,
      connectedCalls,
      missedCalls,
      actualTalkTimeSeconds: actualDurationSeconds,
      actualTalkTimeMinutes: totalActualMinutesConsumed,
      actualTalkTimeFormatted: formatDurationSeconds(actualDurationSeconds),
      averageCallDurationSeconds: averageDurationSeconds,
      averageCallDurationFormatted: formatDurationSeconds(averageDurationSeconds),
      longestCallSeconds,
      longestCallFormatted: formatDurationSeconds(longestCallSeconds),
      totalSessions: totalSessionsCount,
      p50DurationSeconds,
      p90DurationSeconds,
    },

    // ─────────────────────────────────────────────────────────────────────────
    // SECTION B: FINANCIALS
    // ─────────────────────────────────────────────────────────────────────────
    financials: {
      estimatedCarrierCostPaise: estimatedCostPaise,
      estimatedCarrierCostRupees: estimatedCostPaise / 100,
      actualCarrierCostPaise: providerReportedCostPaise,
      actualCarrierCostRupees: providerReportedCostPaise / 100,
      effectiveCarrierCostPaise: effectiveCostPaise,
      effectiveCarrierCostRupees: effectiveCostPaise / 100,
      hasActualCarrierBillingData: providerReportedCostPaise > 0,
      subscriptionRevenuePaise: netRevenuePaise,
      subscriptionRevenueRupees: netRevenuePaise / 100,
      grossSubscriptionRevenuePaise: grossRevenuePaise,
      grossSubscriptionRevenueRupees: grossRevenuePaise / 100,
      costPerActiveSubscriberPaise: costPerActiveSubscriberPaise,
      costPerActiveSubscriberRupees: costPerActiveSubscriberRupees,
      grossContributionPaise: grossContributionPaise,
      grossContributionRupees: grossContributionRupees,
      grossContributionMarginPercent,
      activeSubscribersCount: activeSubscribers,
      carrierRatePerMinuteRupees: pricingConfig.ratePerMinutePaise / 100,
      carrierGstPercent: pricingConfig.gstRate,
      effectiveCarrierRateRupees: (pricingConfig.ratePerMinutePaise * (1 + pricingConfig.gstRate / 100)) / 100,
    },

    // ─────────────────────────────────────────────────────────────────────────
    // SECTION C: USAGE LIMITS
    // ─────────────────────────────────────────────────────────────────────────
    usageLimits: {
      fupThresholdMinutes: 5,
      fupThresholdSeconds: 300,
      usersExceedingFupCount: usersExceedingFup.length,
      usersApproachingFupCount: usersApproachingFup.length,
      callsExceeding10MinCount,
      isWithin10MinCap,
      totalMinutesConsumed,
      totalActualMinutesConsumed,
      expectedUsageMinutes,
      consumptionRatioPercent,
      totalActiveUsersWithCalls: allUserAccounts.length,
      usersExceedingFup,
      usersApproachingFup,
    },

    // ── Backward-compatible summary & root-level shortcuts ──
    summary: {
      period: periodRange.name,
      startsAt: periodRange.startsAt.toISOString(),
      endsAt: periodRange.endsAt.toISOString(),
      totalPlatformMinutesThisMonth: totalMinutesConsumed,
      totalActualMinutesThisMonth: totalActualMinutesConsumed,
      totalCallsThisMonth: totalCalls,
      connectedCallsThisMonth: connectedCalls,
      carrierCost: {
        provider: providerName,
        ratePerMinuteRupees: pricingConfig.ratePerMinutePaise / 100,
        gstPercent: pricingConfig.gstRate,
        rateWithGstRupees: (pricingConfig.ratePerMinutePaise * (1 + pricingConfig.gstRate / 100)) / 100,
        estimatedCostPaise,
        estimatedCostRupees: estimatedCostPaise / 100,
        effectiveCostPaise,
        effectiveCostRupees: effectiveCostPaise / 100,
      },
      subscriptionRevenue: {
        collectedRevenueRupees: grossRevenuePaise / 100,
        refundedRupees: refundedRevenuePaise / 100,
        grossRevenueRupees: grossRevenuePaise / 100,
        netRevenueRupees: netRevenuePaise / 100,
      },
      margin: {
        telephonyMarginRupees: grossContributionRupees,
        telephonyMarginPercent: grossContributionMarginPercent,
        telecomCostRatioPercent:
          netRevenuePaise > 0
            ? Math.round((effectiveCostPaise / netRevenuePaise) * 1000) / 10
            : null,
      },
      fupOversight: {
        thresholdMinutes: 5,
        thresholdSeconds: 300,
        usersExceedingFupCount: usersExceedingFup.length,
        usersApproachingFupCount: usersApproachingFup.length,
        totalActiveUsersWithCalls: allUserAccounts.length,
        fupExceedRatioPercent:
          allUserAccounts.length > 0
            ? Math.round((usersExceedingFup.length / allUserAccounts.length) * 1000) / 10
            : 0,
      },
      callDurationOversight: {
        averageDurationSeconds,
        averageDurationMinutes: Math.round((averageDurationSeconds / 60) * 10) / 10,
        averageDurationFormatted: formatDurationSeconds(averageDurationSeconds),
        p50DurationSeconds,
        p90DurationSeconds,
        maxDurationSeconds: longestCallSeconds,
        maxDurationFormatted: formatDurationSeconds(longestCallSeconds),
        hardCapMinutes: 10,
        hardCapSeconds: 600,
        callsExceeding10MinCount,
        isWithin10MinCap,
        complianceStatus: isWithin10MinCap ? "COMPLIANT" : "CAP_EXCEEDED",
      },
    },

    totalPlatformMinutesThisMonth: totalMinutesConsumed,
    totalActualMinutesThisMonth: totalActualMinutesConsumed,
    estimatedCarrierCostRupees: estimatedCostPaise / 100,
    effectiveCarrierCostRupees: effectiveCostPaise / 100,
    subscriptionRevenueRupees: netRevenuePaise / 100,
    grossSubscriptionRevenueRupees: grossRevenuePaise / 100,
    telephonyMarginRupees: grossContributionRupees,
    usersExceedingFupCount: usersExceedingFup.length,
    usersApproachingFupCount: usersApproachingFup.length,
    averageCallDurationSeconds: averageDurationSeconds,
    averageCallDurationFormatted: formatDurationSeconds(averageDurationSeconds),
    maxCallDurationSeconds: longestCallSeconds,
    callsExceeding10MinCount,
    isWithin10MinCap,
    usersExceedingFup,
    usersApproachingFup,
  };
};
