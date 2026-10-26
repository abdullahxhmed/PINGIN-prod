import type { Request, Response } from "express";
import asyncHandler from "express-async-handler";
import { RequestClaimOtpSchema, VerifyClaimOtpSchema } from "./claims.types.js";
import { requestPurchaseClaimOtp, verifyAndClaimPurchase } from "./claims.services.js";
import { BadRequestError, UnauthorizedError } from "../../errors/AppError.js";

/**
 * Requests an OTP to claim a guest purchase into the logged-in user account.
 * POST /api/orders/claims/request-otp
 */
export const requestClaimOtpController = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    throw new UnauthorizedError("You must be logged in to claim a purchase.");
  }

  const parsed = RequestClaimOtpSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new BadRequestError(parsed.error.issues.map((i) => i.message).join(", "));
  }

  const result = await requestPurchaseClaimOtp(parsed.data, userId);

  res.status(200).json({
    status: "success",
    data: result,
  });
});

/**
 * Verifies OTP and completes claiming of the purchase.
 * POST /api/orders/claims/verify
 */
export const verifyClaimOtpController = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    throw new UnauthorizedError("You must be logged in to claim a purchase.");
  }

  const parsed = VerifyClaimOtpSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new BadRequestError(parsed.error.issues.map((i) => i.message).join(", "));
  }

  const result = await verifyAndClaimPurchase(parsed.data, userId);

  res.status(200).json({
    status: "success",
    data: result,
  });
});
