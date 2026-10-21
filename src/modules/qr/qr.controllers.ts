import asyncHandler from "express-async-handler";
import { BadRequestError } from "../../errors/AppError.js";
import {
  pairQrSchema,
  unpairQrSchema,
  generateSingleSchema,
  createBatchSchema,
} from "./qr.schema.js";
import {
  getQrTagDetails,
  pairQrTag,
  unpairQrTag,
  generateSingleTag,
  createPreprintedBatch,
  getUserTags,
  resolveTagToken,
} from "./qr.services.js";

/**
 * @description Get details and status of a QR tag by scanned token OR tagNumber
 * @route GET /api/qr/:identifier
 * @access public
 */
export const getQrTagDetailsController = asyncHandler(async (req, res) => {
  const { identifier } = req.params;

  if (!identifier || typeof identifier !== "string") {
    throw new BadRequestError("QR identifier parameter is required");
  }

  const details = await getQrTagDetails(identifier);
  res.status(200).json(details);
});

/**
 * @description Pair a QR tag to an owned resource (via qrToken or tagNumber)
 * @route POST /api/qr/pair
 * @access private
 */
export const pairQrTagController = asyncHandler(async (req, res) => {
  const parseResult = pairQrSchema.safeParse(req.body);

  if (!parseResult.success) {
    const errorMsg = parseResult.error.issues[0]?.message || "Invalid pairing request data";
    throw new BadRequestError(errorMsg);
  }

  const { qrToken, tagNumber, resourceId, replaceExistingOnResource } = parseResult.data;

  const result = await pairQrTag({
    userId: req.user.id,
    resourceId,
    qrToken,
    tagNumber,
    replaceExistingOnResource,
  });

  res.status(200).json(result);
});

/**
 * @description Unpair/de-allocate a QR tag from an owned resource
 * @route POST /api/qr/unpair
 * @access private
 */
export const unpairQrTagController = asyncHandler(async (req, res) => {
  const parseResult = unpairQrSchema.safeParse(req.body);

  if (!parseResult.success) {
    const errorMsg = parseResult.error.issues[0]?.message || "Invalid unpair request data";
    throw new BadRequestError(errorMsg);
  }

  const { qrToken, tagNumber, tagId, resourceId } = parseResult.data;

  const result = await unpairQrTag({
    userId: req.user.id,
    qrToken,
    tagNumber,
    tagId,
    resourceId,
  });

  res.status(200).json(result);
});

/**
 * @description Generate a single QR tag on-demand (for a resource or unassigned)
 * @route POST /api/qr/generate
 * @access private (users & admins)
 */
export const generateSingleTagController = asyncHandler(async (req, res) => {
  const parseResult = generateSingleSchema.safeParse(req.body);

  if (!parseResult.success) {
    const errorMsg = parseResult.error.issues[0]?.message || "Invalid generation request data";
    throw new BadRequestError(errorMsg);
  }

  const { resourceId, origin } = parseResult.data;

  const result = await generateSingleTag({
    userId: req.user.id,
    resourceId,
    origin,
  });

  res.status(201).json(result);
});

/**
 * @description Generate a batch of preprinted QR tags for print production (Admin Only)
 * @route POST /api/qr/batch
 * @access private (admin only)
 */
export const createPreprintedBatchController = asyncHandler(async (req, res) => {
  // Support Idempotency-Key from header if not in body
  const headerIdempotencyKey = req.headers["idempotency-key"];
  const bodyWithIdempotency = {
    ...req.body,
    idempotencyKey:
      req.body.idempotencyKey ||
      (typeof headerIdempotencyKey === "string" ? headerIdempotencyKey : undefined),
  };

  const parseResult = createBatchSchema.safeParse(bodyWithIdempotency);

  if (!parseResult.success) {
    const errorMsg = parseResult.error.issues[0]?.message || "Invalid batch request data";
    throw new BadRequestError(errorMsg);
  }

  const { quantity, origin, idempotencyKey } = parseResult.data;

  const result = await createPreprintedBatch({
    quantity,
    origin,
    idempotencyKey,
  });

  res.status(201).json(result);
});

/**
 * @description Get all QR tags owned by the authenticated user
 * @route GET /api/qr/my-tags
 * @access private
 */
export const getUserTagsController = asyncHandler(async (req, res) => {
  const tags = await getUserTags(req.user.id);
  res.status(200).json(tags);
});

/**
 * @description Resolve a physical tag token (/t/:token) to its status, contact info, or claim info
 * @route GET /api/qr/resolve/:token
 * @access public
 */
export const resolveTagTokenController = asyncHandler(async (req, res) => {
  const { token } = req.params;
  if (!token || typeof token !== "string") {
    throw new BadRequestError("Tag token parameter is required");
  }

  const result = await resolveTagToken(token);
  res.status(200).json(result);
});

/**
 * @description Direct HTTP redirect handler for camera scans hitting server at /t/:token or /qr/:token
 * @route GET /t/:token
 * @access public
 */
export const redirectTagScanController = asyncHandler(async (req, res) => {
  const { token } = req.params;
  if (!token || typeof token !== "string") {
    throw new BadRequestError("Tag token parameter is required");
  }

  const publicAppUrl = process.env.PUBLIC_APP_URL || "https://pingin.co.in";
  try {
    const result = await resolveTagToken(token);
    res.redirect(302, `${publicAppUrl}${result.redirectUrl}`);
  } catch (err: any) {
    res.redirect(302, `${publicAppUrl}/tag/invalid`);
  }
});
