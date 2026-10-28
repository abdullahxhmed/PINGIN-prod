import type { Request, Response } from "express";
import asyncHandler from "express-async-handler";
import { ShippingRateRequestSchema } from "./shipping.types.js";
import { calculateShippingRates } from "./shipping.services.js";
import { BadRequestError } from "../../errors/AppError.js";

/**
 * Calculates authoritative shipping rates and free-shipping eligibility.
 * POST /api/shipping/rates
 */
export const calculateShippingRatesController = asyncHandler(
  async (req: Request, res: Response) => {
    const parsed = ShippingRateRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError(parsed.error.issues.map((i) => i.message).join(", "));
    }

    const result = await calculateShippingRates(parsed.data);

    res.status(200).json({
      status: "success",
      data: result,
    });
  }
);

