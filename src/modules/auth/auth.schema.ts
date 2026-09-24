// auth.schemas.ts

import { z } from "zod";

export const verifySignupSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2)
    .max(100),

  mobileNumber: z
    .string()
    .trim()
    .regex(/^\+?[1-9]\d{9,14}$/),

  password: z
    .string()
    .min(8)
    .max(128),

  otp: z
    .string()
    .regex(/^\d{6}$/),
});

export const passwordLoginSchema = z.object({
  mobileNumber: z
    .string()
    .trim()
    .regex(/^\+?[1-9]\d{9,14}$/),

  password: z
    .string()
    .min(8)
    .max(128),
});