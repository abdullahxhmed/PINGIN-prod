import express from "express";
import { requireAdmin } from "../../middleware/admin.middleware.js";
import adminCatalogRoutes from "./catalog/admin.catalog.routes.js";
import adminInventoryRoutes from "./inventory/admin.inventory.routes.js";
import adminOrderRoutes from "./orders/admin.orders.routes.js";
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
  adminGetMailStatusController,
  adminSendTestMailController,
  adminTriggerStockCheckController,
} from "./admin.controllers.js";
import { adminOverviewController } from "./overview/admin.overview.controllers.js";

const router = express.Router();

// All routes in this file are admin-protected
router.use(requireAdmin);

// ---------------------------------------------------------------------------
// Product Catalog Management
// ---------------------------------------------------------------------------
router.use("/catalog", adminCatalogRoutes);

// ---------------------------------------------------------------------------
// QR Tag & Physical Inventory Management
// ---------------------------------------------------------------------------
router.use("/inventory", adminInventoryRoutes);

// ---------------------------------------------------------------------------
// Orders & Fulfillment Management
// ---------------------------------------------------------------------------
router.use("/orders", adminOrderRoutes);

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

/**
 * GET /api/admin/overview?period=today|7d|30d
 * Consolidated operational overview: usage, call costs, activation, plus, and inventory.
 */
router.get("/overview", adminOverviewController);

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

// ---------------------------------------------------------------------------
// Mail Service & Alerts
// ---------------------------------------------------------------------------

/**
 * GET /api/admin/mail/status
 * Get SMTP configuration and connection test status.
 */
router.get("/mail/status", adminGetMailStatusController);

/**
 * POST /api/admin/mail/test
 * Send a test email to the configured admin email.
 */
router.post("/mail/test", adminSendTestMailController);

/**
 * POST /api/admin/mail/check-stock
 * Run an immediate low-stock audit and dispatch alerts.
 */
router.post("/mail/check-stock", adminTriggerStockCheckController);

export default router;
