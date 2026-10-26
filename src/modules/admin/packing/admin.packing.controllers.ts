import asyncHandler from "express-async-handler";
import { BadRequestError } from "../../../errors/AppError.js";
import {
  adminCancelPackingSession,
  adminFinalizePackingSession,
  adminGetPackingSessionStatus,
  adminScanPackingTag,
  adminStartPackingSession,
} from "./admin.packing.services.js";

export const adminGetPackingStatusController = asyncHandler(async (req, res) => {
  const { orderId } = req.params;
  if (!orderId || Array.isArray(orderId)) {
    throw new BadRequestError("Valid orderId is required");
  }

  const result = await adminGetPackingSessionStatus(orderId);
  res.status(200).json({ data: result });
});

export const adminStartPackingController = asyncHandler(async (req, res) => {
  const { orderId } = req.params;
  const { packedBy } = req.body;

  if (!orderId || Array.isArray(orderId)) {
    throw new BadRequestError("Valid orderId is required");
  }

  const operatorName = packedBy || req.user?.id || "warehouse_operator";
  const session = await adminStartPackingSession(orderId, operatorName);

  res.status(201).json({
    message: "Packing session started",
    data: session,
  });
});

export const adminScanTagController = asyncHandler(async (req, res) => {
  const { orderId } = req.params;
  const { sessionId, scannedCode } = req.body;

  if (!orderId || Array.isArray(orderId)) {
    throw new BadRequestError("Valid orderId is required");
  }
  if (!sessionId || !scannedCode) {
    throw new BadRequestError("sessionId and scannedCode are required");
  }

  const result = await adminScanPackingTag(orderId, sessionId, scannedCode);
  res.status(200).json({
    message: result.alreadyScanned ? "Tag already scanned" : "Tag scanned and allocated successfully",
    data: result,
  });
});

export const adminCancelPackingController = asyncHandler(async (req, res) => {
  const { orderId } = req.params;
  const { sessionId, reason } = req.body;

  if (!orderId || Array.isArray(orderId)) {
    throw new BadRequestError("Valid orderId is required");
  }
  if (!sessionId) {
    throw new BadRequestError("sessionId is required");
  }

  const result = await adminCancelPackingSession(orderId, sessionId, reason);
  res.status(200).json({
    message: "Packing session cancelled and inventory restored",
    data: result,
  });
});

export const adminFinalizePackingController = asyncHandler(async (req, res) => {
  const { orderId } = req.params;
  const { sessionId } = req.body;

  if (!orderId || Array.isArray(orderId)) {
    throw new BadRequestError("Valid orderId is required");
  }
  if (!sessionId) {
    throw new BadRequestError("sessionId is required");
  }

  const result = await adminFinalizePackingSession(orderId, sessionId);
  res.status(200).json({
    message: "Order packing manifest finalized. Marked PACKED and ready for shipment.",
    data: result,
  });
});
