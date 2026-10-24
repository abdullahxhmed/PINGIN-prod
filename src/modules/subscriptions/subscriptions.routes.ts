import { Router } from "express";
import { authenticateRequest } from "../auth/auth.middleware.js";
import {
  activatePurchaseController,
  createPurchaseController,
  getAvailablePacksController,
  getMyPurchasesController,
  getMySubscriptionController,
  selectActiveTagsController,
} from "./subscriptions.controllers.js";

const router = Router();

// Public route to view available subscription packs
router.get("/packs", getAvailablePacksController);

// Authenticated routes
router.use(authenticateRequest);

router.get("/me", getMySubscriptionController);
router.post("/select-active-tags", selectActiveTagsController);
router.post("/purchase", createPurchaseController);
router.post("/activate", activatePurchaseController);
router.get("/purchases", getMyPurchasesController);

export default router;
