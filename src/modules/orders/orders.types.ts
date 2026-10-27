import { z } from "zod";

export const ShippingAddressSchema = z.object({
  fullName: z.string().trim().min(2, "Full name must be at least 2 characters"),
  phoneNumber: z.string().trim().min(10, "Phone number must be at least 10 characters"),
  addressLine1: z.string().trim().min(3, "Address line 1 is required"),
  addressLine2: z.string().trim().optional(),
  city: z.string().trim().min(2, "City is required"),
  state: z.string().trim().min(2, "State is required"),
  postalCode: z.string().trim().min(5, "Valid postal code is required"),
  country: z.string().trim().default("IN"),
});

export const CheckoutOrderSchema = z.object({
  checkoutSessionId: z.string().uuid("Invalid checkout session ID"),
  customerEmail: z.string().trim().email("Invalid email address").optional(),
  customerPhone: z.string().trim().min(10, "Phone number must be at least 10 digits").optional(),
  shippingAddress: ShippingAddressSchema,
  checkoutIdempotencyKey: z.string().trim().min(8).max(128).optional(),
}).refine(
  (data) => Boolean(data.customerEmail || data.customerPhone),
  { message: "Either customerEmail or customerPhone must be provided for order notifications." }
);

export type ShippingAddressInput = z.infer<typeof ShippingAddressSchema>;
export type CheckoutOrderInput = z.infer<typeof CheckoutOrderSchema>;

export interface CheckoutResult {
  orderNumber: string;
  orderId: string;
  status: string;
  amount: number; // in paise
  currency: string;
  razorpayOrderId: string;
  keyId: string;
  customerEmail?: string | undefined;
  customerPhone?: string | undefined;
  items: Array<{
    variantName: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
  }>;
}

export interface ReconcilePaymentInput {
  providerOrderId: string;
  providerPaymentId: string;
  amount: number; // paise
  currency?: string | undefined;
  rawPayload?: any;
}

export const VerifyPaymentSchema = z.object({
  orderNumber: z.string().trim().min(1, "Order number is required"),
  razorpayOrderId: z.string().trim().min(1, "Razorpay Order ID is required"),
  razorpayPaymentId: z.string().trim().min(1, "Razorpay Payment ID is required"),
  razorpaySignature: z.string().trim().min(1, "Razorpay signature is required"),
});

export type VerifyPaymentInput = z.infer<typeof VerifyPaymentSchema>;
