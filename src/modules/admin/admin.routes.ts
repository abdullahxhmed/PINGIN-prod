import express from "express";
import { requireAdmin } from "../../middleware/admin.middleware.js";
import {
  adminDashboardController,
  adminListUsersController,
  adminGetUserByIdController,
  adminQrSummaryController,
  adminListQrTagsController,
  adminGenerateSingleTagController,
  adminCreateBatchController,
  adminRevokeQrTagController,
  adminListCommunicationsController,
} from "./admin.controllers.js";

const router = express.Router();

// All routes in this file are admin-protected
router.use(requireAdmin);

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

/**
 * GET /api/admin/dashboard
 * System-wide metrics: users, QR inventory, recent activity.
 */
router.get("/dashboard", adminDashboardController);

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

/**
 * GET /api/admin/users?page=1&limit=20&search=&activeOnly=true
 * List all users with pagination and optional search.
 */
router.get("/users", adminListUsersController);

/**
 * GET /api/admin/users/:userId
 * Detailed view of a single user (resources, tags, contact endpoint).
 */
router.get("/users/:userId", adminGetUserByIdController);

// ---------------------------------------------------------------------------
// QR Inventory
// ---------------------------------------------------------------------------

/**
 * GET /api/admin/qr/summary
 * Inventory counts by status and origin.
 */
router.get("/qr/summary", adminQrSummaryController);

/**
 * GET /api/admin/qr/tags?page=1&limit=50&status=UNASSIGNED&origin=PREPRINTED_INVENTORY
 * Full paginated QR tag inventory.
 */
router.get("/qr/tags", adminListQrTagsController);

/**
 * POST /api/admin/qr/generate
 * Body: { resourceId?: string, origin?: QrTagOrigin }
 * Generate a single QR tag (optionally bound to a resource).
 */
router.post("/qr/generate", adminGenerateSingleTagController);

/**
 * POST /api/admin/qr/batch
 * Header: Idempotency-Key (optional)
 * Body: { quantity: number, origin?: QrTagOrigin, idempotencyKey?: string }
 * Batch-generate preprinted QR sticker inventory.
 */
router.post("/qr/batch", adminCreateBatchController);

/**
 * POST /api/admin/qr/tags/:tagId/revoke
 * Permanently revoke a QR tag.
 */
router.post("/qr/tags/:tagId/revoke", adminRevokeQrTagController);

// ---------------------------------------------------------------------------
// Communications
// ---------------------------------------------------------------------------

/**
 * GET /api/admin/communications?page=1&limit=50&startDate=&endDate=&status=
 * Paginated list of communication sessions with nested call details.
 */
router.get("/communications", adminListCommunicationsController);

export default router;
