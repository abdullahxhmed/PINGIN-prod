import { z } from "zod";

export const RequestClaimOtpSchema = z.object({
  orderNumber: z.string().trim().min(5, "Order number is required"),
  contactType: z.enum(["EMAIL", "PHONE"]).default("PHONE"),
});

export const VerifyClaimOtpSchema = z.object({
  orderNumber: z.string().trim().min(5, "Order number is required"),
  otp: z.string().trim().min(4, "OTP must be at least 4 characters").max(10),
});

export type RequestClaimOtpInput = z.infer<typeof RequestClaimOtpSchema>;
export type VerifyClaimOtpInput = z.infer<typeof VerifyClaimOtpSchema>;
