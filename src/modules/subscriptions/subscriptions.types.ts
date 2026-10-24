import { PurchasePackType, SubscriptionTier } from "@prisma/client";

export interface PlanConfig {
  tier: SubscriptionTier;
  name: string;
  maxActiveTags: number;
  hasLifetimeCalling: boolean;
  hasWhatsappAlerts: boolean;
  hasAnalytics: boolean;
  description: string;
}

export const PLAN_CONFIGS: Record<SubscriptionTier, PlanConfig> = {
  [SubscriptionTier.BASIC]: {
    tier: SubscriptionTier.BASIC,
    name: "Basic Plan",
    maxActiveTags: 2,
    hasLifetimeCalling: true,
    hasWhatsappAlerts: false,
    hasAnalytics: false,
    description: "2 active tags at once with permanent lifetime calling for active tags.",
  },
  [SubscriptionTier.PLUS]: {
    tier: SubscriptionTier.PLUS,
    name: "Plus Plan",
    maxActiveTags: 8,
    hasLifetimeCalling: true,
    hasWhatsappAlerts: true,
    hasAnalytics: true,
    description:
      "8 active tags at once, WhatsApp notification alerts, analytics, and lifetime calling.",
  },
};

export interface PackDefinition {
  packType: PurchasePackType;
  name: string;
  amountPaise: number; // Server source-of-truth integer in paise (e.g. 49900 = ₹499)
  currency: string;
  tagsIncluded: number;
  plusDurationMonths: number;
  badge?: string;
  description: string;
  features: string[];
}

/**
 * Server-side product rules and pricing.
 * Client cannot dictate price, tag quota, or duration.
 */
export const PACK_CATALOG: Record<PurchasePackType, PackDefinition> = {
  [PurchasePackType.PACK_499]: {
    packType: PurchasePackType.PACK_499,
    name: "Pack of 4 Tags + Plus Plan",
    amountPaise: 49900, // ₹499
    currency: "INR",
    tagsIncluded: 4,
    plusDurationMonths: 12,
    badge: "Best Value",
    description: "Includes 4 physical QR tags with 12 months of Plus subscription benefits.",
    features: [
      "4 Pre-printed vehicle/asset QR tags",
      "12 Months Plus subscription included",
      "Up to 8 active tags simultaneously",
      "Instant WhatsApp notification alerts",
      "Complete QR scan & visitor analytics",
      "Lifetime calling for active tags",
      "Prompts to select 2 active tags upon 12-month expiry if not renewed",
    ],
  },
  [PurchasePackType.PACK_179]: {
    packType: PurchasePackType.PACK_179,
    name: "1 Tag + Plus Plan Combo",
    amountPaise: 17900, // ₹179
    currency: "INR",
    tagsIncluded: 1,
    plusDurationMonths: 12,
    badge: "Popular Starter",
    description: "Includes 1 physical QR tag paired with 12 months of Plus subscription benefits.",
    features: [
      "1 Pre-printed QR tag",
      "12 Months Plus subscription included",
      "Up to 8 active tags simultaneously",
      "Instant WhatsApp notification alerts",
      "Complete QR scan & visitor analytics",
      "Lifetime calling for active tags",
      "Prompts to select 2 active tags upon 12-month expiry if not renewed",
    ],
  },
  [PurchasePackType.PLUS_RENEWAL]: {
    packType: PurchasePackType.PLUS_RENEWAL,
    name: "12-Month Plus Plan Renewal",
    amountPaise: 19900, // ₹199
    currency: "INR",
    tagsIncluded: 0,
    plusDurationMonths: 12,
    badge: "Renewal",
    description: "Renew or extend Plus subscription for an additional 12 months with 0 additional tags.",
    features: [
      "12 Months Plus subscription extension",
      "Maintains up to 8 active tags simultaneously",
      "Re-activates any suspended tags automatically",
      "Instant WhatsApp notification alerts",
      "Complete QR scan & visitor analytics",
      "Lifetime calling for active tags",
    ],
  },
  [PurchasePackType.CUSTOM]: {
    packType: PurchasePackType.CUSTOM,
    name: "Custom Enterprise Plan",
    amountPaise: 0,
    currency: "INR",
    tagsIncluded: 0,
    plusDurationMonths: 12,
    description: "Custom volume or enterprise bundle.",
    features: ["Custom tag allocation", "Enterprise SLA & dedicated support"],
  },
};
