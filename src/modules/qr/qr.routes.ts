import express from "express";
import { authenticateRequest } from "../auth/auth.middleware.js";
import { requireAdmin } from "../../middleware/admin.middleware.js";
import {
  getQrTagDetailsController,
  pairQrTagController,
  unpairQrTagController,
  generateSingleTagController,
  createPreprintedBatchController,
  getUserTagsController,
  resolveTagTokenController,
} from "./qr.controllers.js";

const router = express.Router();

// Public route: resolve physical tag token (/t/:token) to current assignment or claim info
router.get("/resolve/:token", resolveTagTokenController);

// Authenticated user tag list (must be declared before /:identifier)
router.get("/my-tags", authenticateRequest, getUserTagsController);
router.get("/user", authenticateRequest, getUserTagsController);

// Public route: scan / inspect QR token OR tagNumber
router.get("/:identifier", getQrTagDetailsController);

// Authenticated routes (Users & Admins)
router.post("/pair", authenticateRequest, pairQrTagController);
router.post("/unpair", authenticateRequest, unpairQrTagController);
router.post("/generate", authenticateRequest, generateSingleTagController);

// Admin-only route: batch creation of printable factory inventory
router.post("/batch", requireAdmin, createPreprintedBatchController);

export default router;
