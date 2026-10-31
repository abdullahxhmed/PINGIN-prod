import { PurchasePackType, SubscriptionTier } from "@prisma/client";
import { z } from "zod";

export interface PlanConfig {
  tier: SubscriptionTier;
  name: string;
  maxActiveTags: number;
  hasLifetimeCalling: boolean;
  hasWhatsappAlerts: boolean;
  hasAnalytics: boolean;
  fupMinutesPerMonth: number;
  hardCallLimitSeconds: number;
  gracePeriodDays: number;
  description: string;
}

export const PLAN_CONFIGS: Record<SubscriptionTier, PlanConfig> = {
  [SubscriptionTier.BASIC]: {
    tier: SubscriptionTier.BASIC,
    name: "Basic Plan",
    maxActiveTags: 4,
    hasLifetimeCalling: false,
    hasWhatsappAlerts: true,
    hasAnalytics: false,
    fupMinutesPerMonth: 0,
    hardCallLimitSeconds: 0,
    gracePeriodDays: 14,
    description: "Expired or unpaid state. All phone calls are disabled; WhatsApp alerts and resumption notices only.",
  },
  [SubscriptionTier.PLUS]: {
    tier: SubscriptionTier.PLUS,
    name: "Plus Plan",
    maxActiveTags: 4,
    hasLifetimeCalling: false,
    hasWhatsappAlerts: true,
    hasAnalytics: true,
    fupMinutesPerMonth: 5,
    hardCallLimitSeconds: 590, // Strictly below 10 minutes (600s)
    gracePeriodDays: 14,
    description:
      "4 digital QR tags, masked phone calls with 5 min/month Fair Use Policy, instant WhatsApp alerts, and scan analytics.",
  },
};

export interface PackDefinition {
  packType: PurchasePackType;
  name: string;
  amountPaise: number; // Server source-of-truth integer in paise (e.g. 14900 = ₹149)
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
  [PurchasePackType.PLUS_149]: {
    packType: PurchasePackType.PLUS_149,
    name: "Plus Plan",
    amountPaise: 14900, // ₹149
    currency: "INR",
    tagsIncluded: 4,
    plusDurationMonths: 12,
    badge: "Official Plan",
    description: "12 months of Plus service with 4 printable digital QR tags, masked calling, WhatsApp alerts, and analytics.",
    features: [
      "4 Digital QR tags (instant printable download)",
      "12 Months Plus subscription included",
      "Masked calling with 5 min/month Fair Use Policy",
      "Strict call duration protection (< 10 minutes)",
      "Instant WhatsApp notifications (no SMS)",
      "Vehicle scan & visitor analytics",
      "14-Day grace period with WhatsApp fallback if expired",
    ],
  },
  [PurchasePackType.PACK_499]: {
    packType: PurchasePackType.PACK_499,
    name: "Pack of 4 Tags + Plus Plan",
    amountPaise: 49900, // ₹499
    currency: "INR",
    tagsIncluded: 4,
    plusDurationMonths: 12,
    badge: "Hardware Kit",
    description: "Includes 4 physical QR tags with 12 months of Plus subscription benefits.",
    features: [
      "4 Pre-printed vehicle/asset QR tags",
      "12 Months Plus subscription included",
      "Up to 4 active tags simultaneously",
      "Instant WhatsApp notification alerts",
      "Complete QR scan & visitor analytics",
      "Masked calling with 5 min/month Fair Use Policy",
    ],
  },
  [PurchasePackType.PACK_179]: {
    packType: PurchasePackType.PACK_179,
    name: "1 Tag + Plus Plan Combo",
    amountPaise: 17900, // ₹179
    currency: "INR",
    tagsIncluded: 1,
    plusDurationMonths: 12,
    badge: "Starter",
    description: "Includes 1 physical QR tag paired with 12 months of Plus subscription benefits.",
    features: [
      "1 Pre-printed QR tag",
      "12 Months Plus subscription included",
      "Up to 4 active tags simultaneously",
      "Instant WhatsApp notification alerts",
      "Complete QR scan & visitor analytics",
    ],
  },
  [PurchasePackType.PLUS_RENEWAL]: {
    packType: PurchasePackType.PLUS_RENEWAL,
    name: "Plus Renewal (12 Months)",
    amountPaise: 14900, // ₹149
    currency: "INR",
    tagsIncluded: 0,
    plusDurationMonths: 12,
    badge: "Renewal",
    description: "12 months of Plus subscription renewal for existing tags.",
    features: [
      "12 Months Plus subscription extension",
      "Maintains up to 4 active tags simultaneously",
      "Re-activates calling services immediately",
      "Instant WhatsApp notification alerts",
      "Complete QR scan & visitor analytics",
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

export const CreateSubscriptionPurchaseSchema = z.object({
  packType: z.enum(
    [
      PurchasePackType.PLUS_149,
      PurchasePackType.PACK_179,
      PurchasePackType.PACK_499,
      PurchasePackType.PLUS_RENEWAL,
      PurchasePackType.CUSTOM,
    ],
    {
      message: "Valid packType is required (PLUS_149, PACK_179, PACK_499, PLUS_RENEWAL, CUSTOM)",
    }
  ),
  paymentProvider: z.string().optional().default("RAZORPAY"),
  metadata: z.record(z.string(), z.any()).optional(),
});

export type CreateSubscriptionPurchaseInput = z.infer<
  typeof CreateSubscriptionPurchaseSchema
>;

export const VerifySubscriptionPaymentSchema = z.object({
  razorpayOrderId: z.string().trim().min(1, "Razorpay Order ID is required"),
  razorpayPaymentId: z.string().trim().min(1, "Razorpay Payment ID is required"),
  razorpaySignature: z.string().trim().min(1, "Razorpay signature is required"),
  purchaseId: z.string().uuid("Invalid purchaseId format").optional(),
});

export type VerifySubscriptionPaymentInput = z.infer<
  typeof VerifySubscriptionPaymentSchema
>;
