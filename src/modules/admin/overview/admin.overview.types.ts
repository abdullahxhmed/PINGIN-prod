export type OverviewPeriod = "today" | "7d" | "30d";

export interface OverviewMeta {
  tz: "Asia/Kolkata";
  period: OverviewPeriod;
  range: {
    start: string; // ISO 8601 UTC (Asia/Kolkata midnight boundary)
    end: string;   // ISO 8601 UTC (Asia/Kolkata midnight boundary)
  };
  previousRange: {
    start: string; // ISO 8601 UTC
    end: string;   // ISO 8601 UTC
  };
  generatedAt: string;
  cached: boolean;
  excludesTestData: boolean; // true by default; false when ?includeTest=1
}

export interface PipelineStage {
  count: number;
  valuePaise: number;
}

export interface OverviewSalesPipeline {
  unpaid: PipelineStage;
  toPack: PipelineStage;
  packing: PipelineStage;
  delivered: PipelineStage;
  cancelledRefunded: PipelineStage;
}

export interface OverviewSalesMetrics {
  revenuePaise: number;
  paidOrders: number;
  checkoutsStarted: number;
  conversionPercent: number | null;
  previous: {
    revenuePaise: number;
    paidOrders: number;
  };
  pipeline: OverviewSalesPipeline;
}

export interface WaitingForTags {
  count: number;
  valuePaise: number;
  oldestAt: string | null; // ISO UTC
  targetHours: number; // 48 hours (2 days)
  orderRefs: string[]; // Order numbers e.g. ["KT304067", "KT564025", "KT659673"]
}

export interface PackVariantStock {
  variantId: string;
  name: string; // "Light", "Dark"
  packs: number;
}

export interface PackAvailable {
  productId: string; // "pair", "complete_set", "stickers", "keychains", "mini_stickers"
  name: string;      // "Pair", "Complete set", "Extra stickers", "Keychains", "Mini stickers"
  packs: number;     // Summed across Light and Dark variants
  variants?: PackVariantStock[];
}

export interface OverviewFulfilmentMetrics {
  waitingForTags: WaitingForTags;
  packsAvailable: PackAvailable[];
  lowStockCount: number;
}

export interface AttentionItem {
  id: string;
  kind: "waiting_for_tags" | "late_shipment" | "unpaid_checkouts" | "low_stock" | "job_errors";
  count: number;
  valuePaise: number | null;
  oldestAt: string | null; // ISO UTC
  targetHours: number | null;
  late: boolean;
  refs: string[];
  route: string;
}

export interface OverviewHealthMetrics {
  callProvider: {
    lastEventAt: string | null; // ISO UTC
  };
  payments: {
    lastCallbackAt: string | null; // ISO UTC
  };
  jobs: {
    errors24h: number;
  };
}

export interface OverviewActivityEvent {
  at: string; // ISO UTC
  type: "order_paid" | "order_delivered" | "call" | "tag_linked";
  ref: string; // order number or tag short code
  customerFirstName: string | null; // privacy: only first name
  summary: string;
  amountPaise: number | null;
  durationSec: number | null;
  outcome: string | null;
  groupedCount: number | null;
}

export interface OverviewLifetimeMetrics {
  users: number;
  registeredTags: number;
  tagsMade: number;
}

export interface UsageMetricPeriod {
  scans: number;
  contactPageVisits: number;
  callsInitiated: number;
  callsConnected: number;
  callsMissed: number;
  ownersReached: number; // Distinct owners who received at least one CONNECTED call
  conversionPercent: number | null; // (visits resulting in a call / total visits) * 100; null on 0 visits
}

export interface OverviewUsageMetrics {
  isApproximate: boolean; // Note: Visitor traffic is bot-filtered & 30s IP-deduplicated
  currentPeriod: UsageMetricPeriod;
  previousPeriod: UsageMetricPeriod;
  allTime: UsageMetricPeriod;
}

export interface TopTagCost {
  tagShortCode: string;
  calls: number;
  billableMinutes: number;
  costPaise: number; // Integer paise
}

export interface OverviewCallCostMetrics {
  ratePerMinutePaise: number; // 150 paise (₹1.50)
  totalBillableMinutes: number; // billable minutes in current period
  estimatedCostPaise: number; // integer paise in current period
  allTimeCostPaise: number; // all-time cost in integer paise
  attributedToTagsPaise: number; // period cost attributed to physical tags
  unattributedPaise: number; // period cost for untagged calls
  averageCostPerConnectedCallPaise: number | null; // (period cost) / (period connected calls); null if 0
  costPerTagWithCallsPaise: number | null; // (period attributed cost) / (period tags with calls); null if 0
  durationSource: "provider" | "estimated";
  config: {
    legs: number; // 2
    gstPercent: number; // 18
  };
  estimatedWithProviderBillingPaise: number; // period cost with 2 legs and GST
  top5TagsByCost: TopTagCost[];
}

export interface OverviewActivationMetrics {
  deliveredTags: number;
  tagsLinkedToVehicles: number;
  tagsWithAtLeastOneCall: number;
  medianDaysDeliveryToLinking: number | null; // null if historical delivery timestamps are unavailable
}

export interface OverviewPlusMetrics {
  activePlusBySource: {
    included_with_order: number;
    paid: number;
    admin_grant: number;
    totalActivePlus: number;
  };
  pendingGrants: number; // Starter packs paid but awaiting physical tag pairing or guest claim
  expiringInNext30Days: number;
  nextExpiryDate: string | null;
}

export interface ConsolidatedTagCounts {
  readyToSell: number; // In warehouse minus reserved / committed demand
  inUse: number;       // Assigned to a vehicle/resource
  inWarehouse: number; // Physical inventory in stock (state = IN_STOCK)
  reserved: number;    // Committed demand / active reservations
  totalPhysicalTags: number; // Total physical tags generated
}

export interface AdminOverviewResponse {
  meta: OverviewMeta;
  sales: OverviewSalesMetrics;
  fulfilment: OverviewFulfilmentMetrics;
  attention: AttentionItem[];
  health: OverviewHealthMetrics;
  activity: OverviewActivityEvent[];
  lifetime: OverviewLifetimeMetrics;
  usage: OverviewUsageMetrics;
  callCost: OverviewCallCostMetrics;
  activation: OverviewActivationMetrics;
  plus: OverviewPlusMetrics;
  consolidatedTagCounts: ConsolidatedTagCounts;
  unavailable: string[]; // List of metric dot-paths that could not be computed
}
