import { Router } from "express";
import { authenticateRequest } from "../auth/auth.middleware.js";
import {
  activatePurchaseController,
  createPurchaseController,
  getAvailablePacksController,
  getMyPurchasesController,
  getMySubscriptionController,
  getUserTelephonyUsageController,
  selectActiveTagsController,
  verifySubscriptionPaymentController,
} from "./subscriptions.controllers.js";

const router = Router();

// Public route to view available subscription packs
router.get("/packs", getAvailablePacksController);

// Authenticated routes
router.use(authenticateRequest);

router.get("/me", getMySubscriptionController);
router.get("/telephony-usage", getUserTelephonyUsageController);
router.post("/select-active-tags", selectActiveTagsController);

// Payment Gateway routes
router.post("/purchase", createPurchaseController);
router.post("/create-order", createPurchaseController);
router.post("/verify-payment", verifySubscriptionPaymentController);
router.post("/activate", activatePurchaseController);

router.get("/purchases", getMyPurchasesController);

export default router;
