import asyncHandler from "express-async-handler";
import { BadRequestError } from "../../errors/AppError.js";
import {
  checkBundleAvailability,
  createAtomicReservation,
  getReservationBySessionId,
  releaseReservation,
} from "./inventory.services.js";

export const checkAvailabilityController = asyncHandler(async (req, res) => {
  const { variantId, quantity = 1 } = req.body;
  if (!variantId) {
    throw new BadRequestError("variantId is required");
  }

  const result = await checkBundleAvailability(variantId, Number(quantity));
  res.status(200).json({
    data: result,
  });
});

export const createReservationController = asyncHandler(async (req, res) => {
  const { checkoutSessionId, items, variantId, quantity } = req.body;
  const userId = req.user?.id ?? null; // Nullable for guest checkout

  if (!checkoutSessionId) {
    throw new BadRequestError("checkoutSessionId is required");
  }

  if ((!items || !Array.isArray(items) || items.length === 0) && !variantId) {
    throw new BadRequestError("Either 'items' array or 'variantId' and 'quantity' are required");
  }

  const reservation = await createAtomicReservation({
    checkoutSessionId,
    items,
    variantId,
    quantity: quantity !== undefined ? Number(quantity) : undefined,
    userId,
  });

  res.status(201).json({
    data: reservation,
  });
});

export const getReservationController = asyncHandler(async (req, res) => {
  const { checkoutSessionId } = req.params;
  if (!checkoutSessionId || Array.isArray(checkoutSessionId)) {
    throw new BadRequestError("Valid checkoutSessionId is required");
  }

  const reservation = await getReservationBySessionId(checkoutSessionId);
  res.status(200).json({
    data: reservation,
  });
});

export const releaseReservationController = asyncHandler(async (req, res) => {
  const { reservationId } = req.params;
  if (!reservationId || Array.isArray(reservationId)) {
    throw new BadRequestError("Valid reservationId is required");
  }

  const reservation = await releaseReservation(reservationId);
  res.status(200).json({
    data: reservation,
  });
});

