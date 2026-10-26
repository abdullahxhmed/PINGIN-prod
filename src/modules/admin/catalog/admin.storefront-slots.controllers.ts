import asyncHandler from "express-async-handler";
import { BadRequestError } from "../../../errors/AppError.js";
import {
  adminBatchSyncStorefrontSlots,
  adminCreateStorefrontSlot,
  adminDeleteStorefrontSlot,
  adminGetStorefrontSlotHistory,
  adminListStorefrontSlots,
  adminUpdateStorefrontSlot,
} from "./admin.storefront-slots.services.js";

export const adminListStorefrontSlotsController = asyncHandler(async (_req, res) => {
  const result = await adminListStorefrontSlots();
  res.status(200).json({
    message: "Storefront slots retrieved successfully.",
    data: result,
  });
});

export const adminCreateStorefrontSlotController = asyncHandler(async (req, res) => {
  const { slotKey, label, slotType, displayOrder, productId, variantId, reason } = req.body;
  if (!slotKey || typeof slotKey !== "string") {
    throw new BadRequestError("Valid slotKey is required.");
  }
  if (!label || typeof label !== "string") {
    throw new BadRequestError("Valid label is required.");
  }
  if (!slotType || (slotType !== "BUNDLE" && slotType !== "INDIVIDUAL")) {
    throw new BadRequestError("slotType must be 'BUNDLE' or 'INDIVIDUAL'.");
  }

  const slot = await adminCreateStorefrontSlot({
    slotKey,
    label,
    slotType,
    displayOrder: typeof displayOrder === "number" ? displayOrder : undefined,
    productId: productId === null || typeof productId === "string" ? productId : undefined,
    variantId: variantId === null || typeof variantId === "string" ? variantId : undefined,
    reason: typeof reason === "string" ? reason : undefined,
    changedBy: (req as any).user?.id || "admin",
  });

  res.status(201).json({
    message: `Storefront slot '${slotKey}' created successfully.`,
    data: slot,
  });
});

export const adminUpdateStorefrontSlotController = asyncHandler(async (req, res) => {
  const { slotKey } = req.params;
  if (!slotKey || Array.isArray(slotKey)) {
    throw new BadRequestError("Valid slotKey parameter is required.");
  }

  const { label, displayOrder, active, productId, variantId, reason } = req.body;

  const slot = await adminUpdateStorefrontSlot(slotKey, {
    label: typeof label === "string" ? label : undefined,
    displayOrder: typeof displayOrder === "number" ? displayOrder : undefined,
    active: typeof active === "boolean" ? active : undefined,
    productId: productId === null || typeof productId === "string" ? productId : undefined,
    variantId: variantId === null || typeof variantId === "string" ? variantId : undefined,
    reason: typeof reason === "string" ? reason : undefined,
    changedBy: (req as any).user?.id || "admin",
  });

  res.status(200).json({
    message: `Storefront slot '${slotKey}' updated successfully.`,
    data: slot,
  });
});

export const adminDeleteStorefrontSlotController = asyncHandler(async (req, res) => {
  const { slotKey } = req.params;
  if (!slotKey || Array.isArray(slotKey)) {
    throw new BadRequestError("Valid slotKey parameter is required.");
  }

  const result = await adminDeleteStorefrontSlot(slotKey, (req as any).user?.id || "admin");
  res.status(200).json(result);
});

export const adminBatchSyncStorefrontSlotsController = asyncHandler(async (req, res) => {
  const { slots, reason } = req.body;
  if (!Array.isArray(slots) || slots.length === 0) {
    throw new BadRequestError("slots must be a non-empty array of slot sync configurations.");
  }

  const results = await adminBatchSyncStorefrontSlots({
    slots,
    reason: typeof reason === "string" ? reason : undefined,
    changedBy: (req as any).user?.id || "admin",
  });

  res.status(200).json({
    message: "Storefront slots synchronized successfully.",
    data: results,
  });
});

export const adminGetStorefrontSlotHistoryController = asyncHandler(async (req, res) => {
  const { page, limit, slotKey } = req.query;

  const result = await adminGetStorefrontSlotHistory({
    page: page ? Number(page) : 1,
    limit: limit ? Number(limit) : 25,
    slotKey: typeof slotKey === "string" ? slotKey : undefined,
  });

  res.status(200).json(result);
});
