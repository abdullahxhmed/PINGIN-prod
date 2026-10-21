import { z } from "zod";

export const pairQrSchema = z
  .object({
    qrToken: z.string().trim().min(1).optional(),
    tagNumber: z.string().trim().min(5).max(10).optional(),
    resourceId: z.string().uuid("Invalid resource ID format"),
    replaceExistingOnResource: z.boolean().optional().default(false),
  })
  .refine((data) => Boolean(data.qrToken || data.tagNumber), {
    message: "Must provide either qrToken (from scan) or tagNumber (from sticker text)",
  });

export const unpairQrSchema = z
  .object({
    qrToken: z.string().trim().min(1).optional(),
    tagNumber: z.string().trim().min(5).max(10).optional(),
    tagId: z.string().uuid("Invalid tag ID format").optional(),
    resourceId: z.string().uuid("Invalid resource ID format").optional(),
  })
  .refine(
    (data) => Boolean(data.qrToken || data.tagNumber || data.tagId || data.resourceId),
    {
      message: "Must provide at least one identifier: qrToken, tagNumber, tagId, or resourceId",
    }
  );

export const generateSingleSchema = z.object({
  resourceId: z.string().uuid("Invalid resource ID format").optional(),
  origin: z
    .enum(["PREPRINTED_INVENTORY", "GENERATED_FOR_RESOURCE"])
    .optional(),
});

export const createBatchSchema = z.object({
  quantity: z
    .number()
    .int()
    .min(1, "Quantity must be at least 1")
    .max(5000, "Maximum batch quantity is 5,000"),
  origin: z
    .enum(["PREPRINTED_INVENTORY", "GENERATED_FOR_RESOURCE"])
    .optional()
    .default("PREPRINTED_INVENTORY"),
  idempotencyKey: z
    .string()
    .trim()
    .min(8, "Idempotency key must be at least 8 characters")
    .max(128)
    .optional(),
});
