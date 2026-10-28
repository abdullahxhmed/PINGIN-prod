import { z } from "zod";

export const ShippingRateItemSchema = z
  .object({
    variantId: z.string().uuid("Invalid variantId UUID").optional(),
    productId: z.string().uuid("Invalid productId UUID").optional(),
    quantity: z
      .number()
      .int("Quantity must be an integer")
      .positive("Quantity must be greater than 0")
      .max(50, "Maximum allowed quantity per line item is 50"),
  })
  .refine((data) => Boolean(data.variantId || data.productId), {
    message: "Either variantId or productId must be provided for each item",
  });

export const ShippingRateRequestSchema = z.object({
  items: z.array(ShippingRateItemSchema).min(1, "At least one item is required in cart"),
  deliveryPincode: z
    .string()
    .trim()
    .regex(/^[1-9][0-9]{5}$/, "Delivery pincode must be a valid 6-digit Indian postal code"),
  paymentMethod: z.enum(["PREPAID", "COD"]).default("PREPAID"),
});

export type ShippingRateItemInput = z.infer<typeof ShippingRateItemSchema>;
export type ShippingRateRequestInput = z.infer<typeof ShippingRateRequestSchema>;

export interface ShippingRateCourierDetails {
  courierCompanyId?: number | undefined;
  name: string;
  estimatedDeliveryDays?: string | undefined;
  etd?: string | null | undefined;
}

export interface ShippingRatePackageDetails {
  weightGrams: number;
  dimensions: {
    lengthCm: number;
    breadthCm: number;
    heightCm: number;
  };
}

export interface ShippingRateResponseData {
  isServiceable: boolean;
  freeShippingThreshold: number; // 40000 paise (₹400)
  isFreeShipping: boolean;
  subtotalAmount: number; // in paise
  shippingFee: number | null; // in paise, 0 if free shipping, null if unserviceable
  estimatedTax: number; // 0 in paise
  estimatedTotal: number; // in paise (subtotal + shippingFee)
  currency: string;
  deliveryPincode: string;
  paymentMethod: "PREPAID" | "COD";
  courier?: ShippingRateCourierDetails | null | undefined;
  packageDetails: ShippingRatePackageDetails;
  unserviceableReason?: string | undefined;
}
