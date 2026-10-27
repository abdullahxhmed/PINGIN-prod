import type { Request, Response } from "express";
import asyncHandler from "express-async-handler";
import { BadRequestError } from "../../errors/AppError.js";
import {
  activatePackPurchase,
  createPackPurchase,
  getUserPurchases,
  getUserSubscription,
  selectActiveTags,
  verifySubscriptionPayment,
} from "./subscriptions.services.js";
import {
  CreateSubscriptionPurchaseSchema,
  PACK_CATALOG,
  VerifySubscriptionPaymentSchema,
} from "./subscriptions.types.js";
import { PurchasePackType } from "@prisma/client";

export const getMySubscriptionController = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = req.user?.id;
    if (!userId) {
      throw new BadRequestError("User authentication required");
    }

    const data = await getUserSubscription(userId);
    res.status(200).json({
      success: true,
      data,
    });
  }
);

export const getAvailablePacksController = asyncHandler(
  async (_req: Request, res: Response) => {
    res.status(200).json({
      success: true,
      data: {
        packs: Object.values(PACK_CATALOG),
      },
    });
  }
);

export const selectActiveTagsController = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = req.user?.id;
    if (!userId) {
      throw new BadRequestError("User authentication required");
    }

    const { activeTagIds } = req.body;
    if (!Array.isArray(activeTagIds)) {
      throw new BadRequestError("activeTagIds must be an array of tag IDs");
    }

    const result = await selectActiveTags(userId, activeTagIds);
    res.status(200).json({
      success: true,
      message: "Active tags updated successfully.",
      data: result,
    });
  }
);

export const createPurchaseController = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = req.user?.id;
    if (!userId) {
      throw new BadRequestError("User authentication required");
    }

    const parsed = CreateSubscriptionPurchaseSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError(
        parsed.error.issues.map((i) => i.message).join(", ")
      );
    }

    const { packType, paymentProvider, metadata } = parsed.data;

    const result = await createPackPurchase(
      userId,
      packType as PurchasePackType,
      paymentProvider,
      metadata
    );

    res.status(201).json({
      success: true,
      message: "Payment order initiated successfully.",
      data: result,
    });
  }
);

/**
 * Verifies Razorpay cryptographic signature and activates the subscription instantly.
 * POST /api/subscriptions/verify-payment
 */
export const verifySubscriptionPaymentController = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = req.user?.id;
    if (!userId) {
      throw new BadRequestError("User authentication required");
    }

    const parsed = VerifySubscriptionPaymentSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError(
        parsed.error.issues.map((i) => i.message).join(", ")
      );
    }

    const result = await verifySubscriptionPayment(userId, parsed.data);

    res.status(200).json({
      success: true,
      status: "success",
      message: result.message,
      data: result,
    });
  }
);

export const activatePurchaseController = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = req.user?.id;
    if (!userId) {
      throw new BadRequestError("User authentication required");
    }

    const { purchaseId, packType, paymentProvider, providerOrderId, providerPaymentId } =
      req.body;

    const result = await activatePackPurchase(userId, {
      purchaseId,
      packType,
      paymentProvider,
      providerOrderId,
      providerPaymentId,
    });

    res.status(200).json({
      success: true,
      message: result.message,
      data: result,
    });
  }
);

export const getMyPurchasesController = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = req.user?.id;
    if (!userId) {
      throw new BadRequestError("User authentication required");
    }

    const purchases = await getUserPurchases(userId);
    res.status(200).json({
      success: true,
      data: {
        purchases,
      },
    });
  }
);
