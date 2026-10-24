import type { Request, Response } from "express";
import asyncHandler from "express-async-handler";
import { BadRequestError } from "../../errors/AppError.js";
import {
  activatePackPurchase,
  createPackPurchase,
  getUserPurchases,
  getUserSubscription,
  selectActiveTags,
} from "./subscriptions.services.js";
import { PACK_CATALOG } from "./subscriptions.types.js";
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

    const { packType, paymentProvider, metadata } = req.body;
    if (!packType || !Object.values(PurchasePackType).includes(packType)) {
      throw new BadRequestError("Valid packType is required (PACK_499, PACK_179, PLUS_RENEWAL)");
    }

    const result = await createPackPurchase(
      userId,
      packType as PurchasePackType,
      paymentProvider,
      metadata
    );

    res.status(201).json({
      success: true,
      message: "Purchase initiated successfully.",
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
