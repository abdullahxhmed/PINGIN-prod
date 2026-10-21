import { z } from "zod";
import { QrTagStatus, QrTagOrigin } from "@prisma/client";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(20),
});

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export const adminListUsersSchema = paginationSchema.extend({
  search: z.string().optional(),
  activeOnly: z
    .string()
    .optional()
    .transform((v) => v !== "false"),
});

export const adminUserIdParamSchema = z.object({
  userId: z.string().uuid("userId must be a valid UUID"),
});

// ---------------------------------------------------------------------------
// QR Inventory
// ---------------------------------------------------------------------------

export const adminListQrTagsSchema = paginationSchema.extend({
  status: z.nativeEnum(QrTagStatus).optional(),
  origin: z.nativeEnum(QrTagOrigin).optional(),
});

export const adminTagIdParamSchema = z.object({
  tagId: z.string().uuid("tagId must be a valid UUID"),
});

// ---------------------------------------------------------------------------
// Communications
// ---------------------------------------------------------------------------

export const adminCallReportSchema = paginationSchema.extend({
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  status: z
    .enum(["PENDING", "ACTIVE", "EXPIRED"])
    .optional(),
});
