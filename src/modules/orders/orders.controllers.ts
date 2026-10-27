import type { Request, Response } from "express";
import asyncHandler from "express-async-handler";
import { CheckoutOrderSchema, VerifyPaymentSchema } from "./orders.types.js";
import {
  createOrderFromCheckout,
  getOrderStatus,
  trackOrderPublicly,
  verifyAndConfirmPayment,
} from "./orders.services.js";
import { BadRequestError } from "../../errors/AppError.js";

/**
 * Initiates guest or user checkout from an active reservation.
 * POST /api/orders/checkout
 */
export const checkoutOrderController = asyncHandler(async (req: Request, res: Response) => {
  const parsed = CheckoutOrderSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new BadRequestError(parsed.error.issues.map((i) => i.message).join(", "));
  }

  const authenticatedUserId = req.user?.id;
  const result = await createOrderFromCheckout(parsed.data, authenticatedUserId);

  res.status(201).json({
    status: "success",
    data: result,
  });
});

/**
 * Direct cryptographic verification of Razorpay payment signature.
 * Transitions order to PAID instantly (<200ms) without waiting for webhook polling.
 * POST /api/orders/verify-payment
 */
export const verifyPaymentController = asyncHandler(async (req: Request, res: Response) => {
  const parsed = VerifyPaymentSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new BadRequestError(parsed.error.issues.map((i) => i.message).join(", "));
  }

  const result = await verifyAndConfirmPayment(parsed.data);

  res.status(200).json({
    success: true,
    status: "success",
    orderNumber: result.orderNumber,
    data: result,
  });
});

/**
 * Retrieves public status of an order by orderNumber.
 * GET /api/orders/:orderNumber/status
 */
export const getOrderStatusController = asyncHandler(async (req: Request, res: Response) => {
  const { orderNumber } = req.params;
  if (!orderNumber || Array.isArray(orderNumber)) {
    throw new BadRequestError("Valid orderNumber parameter is required");
  }

  const result = await getOrderStatus(orderNumber);

  res.status(200).json({
    status: "success",
    data: result,
  });
});

/**
 * Public tracking endpoint supporting either orderNumber or courier AWB code.
 * GET /api/orders/track/:identifier (e.g. /api/orders/track/PK-ORD-... or /api/orders/track/142981029481)
 */
export const trackOrderPubliclyController = asyncHandler(async (req: Request, res: Response) => {
  const { identifier } = req.params;
  if (!identifier || Array.isArray(identifier)) {
    throw new BadRequestError("Valid orderNumber or AWB tracking code is required");
  }

  const result = await trackOrderPublicly(identifier);

  res.status(200).json({
    status: "success",
    data: result,
  });
});

