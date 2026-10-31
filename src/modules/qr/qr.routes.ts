import express from "express";
import { authenticateRequest } from "../auth/auth.middleware.js";
import { requireAdmin } from "../../middleware/admin.middleware.js";
import {
  getQrTagDetailsController,
  pairQrTagController,
  unpairQrTagController,
  generateSingleTagController,
  generateDigitalTagController,
  getDigitalTagPrintableController,
  createPreprintedBatchController,
  getUserTagsController,
  resolveTagTokenController,
  pauseQrTagController,
  resumeQrTagController,
} from "./qr.controllers.js";

const router = express.Router();

// Public route: resolve physical tag token (/t/:token) to current assignment or claim info
router.get("/resolve/:token", resolveTagTokenController);

// Authenticated user tag list (must be declared before /:identifier)
router.get("/my-tags", authenticateRequest, getUserTagsController);
router.get("/user", authenticateRequest, getUserTagsController);

// Authenticated routes (Users & Admins) - Specific paths before /:identifier
router.post("/pair", authenticateRequest, pairQrTagController);
router.post("/unpair", authenticateRequest, unpairQrTagController);
router.post("/pause", authenticateRequest, pauseQrTagController);
router.post("/resume", authenticateRequest, resumeQrTagController);
router.post("/generate", authenticateRequest, generateSingleTagController);
router.post("/digital/generate", authenticateRequest, generateDigitalTagController);
router.get("/digital/:identifier/print", authenticateRequest, getDigitalTagPrintableController);

// Admin-only route: batch creation of printable factory inventory
router.post("/batch", requireAdmin, createPreprintedBatchController);

// Dynamic identifier routes
router.post("/:identifier/pause", authenticateRequest, pauseQrTagController);
router.post("/:identifier/resume", authenticateRequest, resumeQrTagController);
router.get("/:identifier/print", authenticateRequest, getDigitalTagPrintableController);

// Public route: scan / inspect QR token OR tagNumber
router.get("/:identifier", getQrTagDetailsController);

export default router;
