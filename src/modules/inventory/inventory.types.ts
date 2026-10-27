import { ReservationStatus } from "@prisma/client";

export const RESERVATION_TTL_MINUTES = 15;
export const RESERVATION_GRACE_WINDOW_MINUTES = 10;
export const MAX_RESERVATION_QUANTITY = 50;

export interface CartItemInput {
  variantId: string;
  quantity: number;
}

export interface CreateReservationInput {
  checkoutSessionId: string;
  items?: CartItemInput[] | undefined;
  variantId?: string | undefined;
  quantity?: number | undefined;
  userId?: string | null | undefined;
}

export interface AvailabilityResult {
  available: boolean;
  requiredTags: number;
  availableTags: number;
  shortages: string[];
}

export interface ReservationSummary {
  id: string;
  checkoutSessionId: string;
  status: ReservationStatus;
  expiresAt: Date;
  items: Array<{
    variantId: string;
    variantName: string;
    quantity: number;
    unitPrice: number;
  }>;
  totalQuantity: number;
  totalAmount: number;
  userId?: string | null;
}

export interface SkuDemandBreakdown {
  sku: string;
  paidUnfulfilledDemand: number;
  activeReservationsDemand: number;
  totalCommittedDemand: number;
}
