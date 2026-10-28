import asyncHandler from "express-async-handler";
import { BadRequestError, NotFoundError } from "../../errors/AppError.js";
import {
  adminListUsersSchema,
  adminUserIdParamSchema,
  adminListQrTagsSchema,
  adminTagIdParamSchema,
  adminCallReportSchema,
} from "./admin.schema.js";
import {
  adminListUsers,
  adminGetUserById,
  adminListQrTags,
  adminQrInventorySummary,
  adminRevokeQrTag,
  adminListCommunicationSessions,
  adminDashboardSummary,
} from "./admin.services.js";
import {
  generateSingleTag,
  createPreprintedBatch,
} from "../qr/qr.services.js";
import { mailService, isMailConfigured, getMailConfig } from "../../integrations/mail/index.js";
import { logger } from "../../lib/logger.js";
import { prisma } from "../../lib/prisma.js";

// ---------------------------------------------------------------------------
// DASHBOARD
// ---------------------------------------------------------------------------

/**
 * @route   GET /api/admin/dashboard
 * @desc    High-level system-wide metrics summary
 * @access  Admin
 */
export const adminDashboardController = asyncHandler(async (_req, res) => {
  const summary = await adminDashboardSummary();
  res.status(200).json(summary);
});

// ---------------------------------------------------------------------------
// USERS
// ---------------------------------------------------------------------------

/**
 * @route   GET /api/admin/users
 * @desc    Paginated list of all users with optional search
 * @access  Admin
 */
export const adminListUsersController = asyncHandler(async (req, res) => {
  const parsed = adminListUsersSchema.safeParse(req.query);
  if (!parsed.success) {
    throw new BadRequestError(parsed.error.issues[0]?.message ?? "Invalid query parameters");
  }
  const adminId = (req as any).user?.id ?? "admin";
  logger.info(
    { event: "ADMIN_AUDIT_USER_LIST", adminId, query: parsed.data },
    `[ADMIN_AUDIT] Admin ${adminId} accessed user list`
  );
  prisma.adminAuditLog
    .create({
      data: {
        adminId,
        action: "LIST_USERS",
        metadata: { query: parsed.data, ip: req.ip },
      },
    })
    .catch((err) => logger.error({ err }, "Failed to write AdminAuditLog"));

  const result = await adminListUsers(parsed.data);
  res.status(200).json(result);
});

/**
 * @route   GET /api/admin/users/:userId
 * @desc    Full detail view for a single user (resources, tags, contact endpoint)
 * @access  Admin
 */
export const adminGetUserByIdController = asyncHandler(async (req, res) => {
  const parsed = adminUserIdParamSchema.safeParse(req.params);
  if (!parsed.success) {
    throw new BadRequestError(parsed.error.issues[0]?.message ?? "Invalid userId");
  }
  const adminId = (req as any).user?.id ?? "admin";
  logger.info(
    { event: "ADMIN_AUDIT_VIEW_USER", adminId, targetUserId: parsed.data.userId },
    `[ADMIN_AUDIT] Admin ${adminId} viewed per-user details for user ${parsed.data.userId}`
  );
  prisma.adminAuditLog
    .create({
      data: {
        adminId,
        action: "VIEW_USER_DETAILS",
        target: parsed.data.userId,
        metadata: { ip: req.ip, userAgent: req.headers["user-agent"] },
      },
    })
    .catch((err) => logger.error({ err }, "Failed to write AdminAuditLog"));

  const user = await adminGetUserById(parsed.data.userId);
  if (!user) throw new NotFoundError("User not found.");
  res.status(200).json(user);
});

// ---------------------------------------------------------------------------
// QR INVENTORY
// ---------------------------------------------------------------------------

/**
 * @route   GET /api/admin/qr/summary
 * @desc    QR tag inventory counts by status and origin
 * @access  Admin
 */
export const adminQrSummaryController = asyncHandler(async (_req, res) => {
  const summary = await adminQrInventorySummary();
  res.status(200).json(summary);
});

/**
 * @route   GET /api/admin/qr/tags
 * @desc    Paginated list of all QR tags with optional filter
 * @access  Admin
 */
export const adminListQrTagsController = asyncHandler(async (req, res) => {
  const parsed = adminListQrTagsSchema.safeParse(req.query);
  if (!parsed.success) {
    throw new BadRequestError(parsed.error.issues[0]?.message ?? "Invalid query parameters");
  }
  const result = await adminListQrTags(parsed.data);
  res.status(200).json(result);
});

/**
 * @route   POST /api/admin/qr/generate
 * @desc    Generate a single QR tag (admin can create without a resourceId)
 * @access  Admin
 */
export const adminGenerateSingleTagController = asyncHandler(async (req, res) => {
  const { resourceId, origin } = req.body ?? {};
  const result = await generateSingleTag({
    userId: (req as any).user?.id ?? "admin",
    resourceId,
    origin,
  });
  res.status(201).json(result);
});

/**
 * @route   POST /api/admin/qr/batch
 * @desc    Generate a batch of preprinted QR tags (Admin Only)
 * @access  Admin
 */
export const adminCreateBatchController = asyncHandler(async (req, res) => {
  const headerKey = req.headers["idempotency-key"];
  const body = {
    ...req.body,
    idempotencyKey:
      req.body?.idempotencyKey ||
      (typeof headerKey === "string" ? headerKey : undefined),
  };

  const { quantity, origin, idempotencyKey } = body;

  if (!quantity || typeof quantity !== "number" || quantity < 1) {
    throw new BadRequestError("quantity must be a positive integer.");
  }

  const result = await createPreprintedBatch({ quantity, origin, idempotencyKey });
  res.status(201).json(result);
});

/**
 * @route   POST /api/admin/qr/tags/:tagId/revoke
 * @desc    Permanently revoke a QR tag
 * @access  Admin
 */
export const adminRevokeQrTagController = asyncHandler(async (req, res) => {
  const parsed = adminTagIdParamSchema.safeParse(req.params);
  if (!parsed.success) {
    throw new BadRequestError(parsed.error.issues[0]?.message ?? "Invalid tagId");
  }
  const result = await adminRevokeQrTag(parsed.data.tagId);
  if (!result) throw new NotFoundError("QR tag not found.");
  res.status(200).json({ message: "QR tag revoked successfully.", ...result });
});

// ---------------------------------------------------------------------------
// COMMUNICATIONS
// ---------------------------------------------------------------------------

/**
 * @route   GET /api/admin/communications
 * @desc    Paginated communication sessions with call details
 * @access  Admin
 */
export const adminListCommunicationsController = asyncHandler(async (req, res) => {
  const parsed = adminCallReportSchema.safeParse(req.query);
  if (!parsed.success) {
    throw new BadRequestError(parsed.error.issues[0]?.message ?? "Invalid query parameters");
  }
  const result = await adminListCommunicationSessions(parsed.data);
  res.status(200).json(result);
});

// ---------------------------------------------------------------------------
// MAIL & SYSTEM ALERTS
// ---------------------------------------------------------------------------

/**
 * @route   GET /api/admin/mail/status
 * @desc    Get SMTP configuration status and test connection
 * @access  Admin
 */
export const adminGetMailStatusController = asyncHandler(async (_req, res) => {
  const config = getMailConfig();
  const configured = isMailConfigured();
  const connection = await mailService.verifyConnection();

  res.status(200).json({
    configured,
    host: config.host || "(not set)",
    port: config.port,
    secure: config.secure,
    service: config.service || null,
    user: config.user ? `${config.user.slice(0, 3)}***` : "(not set)",
    from: config.from,
    adminEmail: config.adminEmail,
    connection,
  });
});

/**
 * @route   POST /api/admin/mail/test
 * @desc    Send a test notification email to the configured admin address
 * @access  Admin
 */
export const adminSendTestMailController = asyncHandler(async (req, res) => {
  const result = await mailService.sendCustomAdminNotification({
    subject: "Test Notification from ParkPing Server",
    title: "Mail Service Configuration Test",
    message: "This is a test notification confirming that Nodemailer is correctly configured with your SMTP credentials on ParkPing.",
    severity: "INFO",
    details: {
      testTimestamp: new Date().toISOString(),
      triggeredByIp: req.ip,
      userAgent: req.headers["user-agent"],
    },
  });

  if (!result) {
    throw new BadRequestError("Failed to deliver test email. Check server logs and SMTP credentials.");
  }

  res.status(200).json({
    message: "Test email successfully sent to admin.",
  });
});

/**
 * @route   POST /api/admin/mail/check-stock
 * @desc    Trigger immediate stock evaluation across inventory and send low-stock alerts
 * @access  Admin
 */
export const adminTriggerStockCheckController = asyncHandler(async (_req, res) => {
  const alerts = await mailService.checkAndAlertLowStock({
    triggeredBy: "Manual Admin Stock Check API",
    bypassCooldown: true,
  });

  res.status(200).json({
    message: `Evaluated inventory stock. Dispatched ${alerts.length} alert(s).`,
    alerts,
  });
});

