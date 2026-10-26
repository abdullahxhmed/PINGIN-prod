import asyncHandler from "express-async-handler";
import { BadRequestError } from "../../../errors/AppError.js";
import {
  adminBatchGenerateTags,
  adminGetInventorySummary,
  adminListBulkStock,
  adminListTagInventory,
  adminUpdateTagStockState,
  adminUpsertBulkStock,
} from "./admin.inventory.services.js";

export const adminGetInventorySummaryController = asyncHandler(async (_req, res) => {
  const summary = await adminGetInventorySummary();
  res.status(200).json({ data: summary });
});

export const adminListTagInventoryController = asyncHandler(async (req, res) => {
  const { page, limit, sku, state, search } = req.query;

  const result = await adminListTagInventory({
    page: page ? Number(page) : 1,
    limit: limit ? Number(limit) : 50,
    sku: typeof sku === "string" ? sku : undefined,
    state: typeof state === "string" ? (state as any) : undefined,
    search: typeof search === "string" ? search : undefined,
  });

  res.status(200).json(result);
});

export const adminBatchGenerateTagsController = asyncHandler(async (req, res) => {
  const headerKey = req.headers["idempotency-key"];
  const idempotencyKey =
    req.body?.idempotencyKey || (typeof headerKey === "string" ? headerKey : undefined);

  const { sku, quantity, origin } = req.body ?? {};

  if (!sku || typeof sku !== "string") {
    throw new BadRequestError("sku is required to bind physical tags to a product type.");
  }
  if (!quantity || typeof quantity !== "number" || quantity <= 0) {
    throw new BadRequestError("quantity must be a positive integer.");
  }

  const result = await adminBatchGenerateTags({
    sku,
    quantity,
    origin,
    idempotencyKey,
  });

  res.status(201).json({
    message: `Batch of ${result.count} tags generated successfully bound to SKU '${sku}'.`,
    data: result,
  });
});

export const adminUpdateTagStockStateController = asyncHandler(async (req, res) => {
  const { tagId } = req.params;
  const { state, reason } = req.body ?? {};

  if (!tagId || Array.isArray(tagId)) {
    throw new BadRequestError("Valid tagId is required");
  }
  if (!state) {
    throw new BadRequestError("state is required");
  }

  const result = await adminUpdateTagStockState(tagId, { state, reason });
  res.status(200).json({
    message: "Tag stock state updated successfully.",
    data: result,
  });
});

export const adminListBulkStockController = asyncHandler(async (_req, res) => {
  const items = await adminListBulkStock();
  res.status(200).json({ data: items });
});

export const adminUpsertBulkStockController = asyncHandler(async (req, res) => {
  const { sku, name, quantityOnHandDelta, reorderLevel } = req.body ?? {};

  if (!sku || !name || quantityOnHandDelta === undefined) {
    throw new BadRequestError("sku, name, and quantityOnHandDelta are required.");
  }

  const stock = await adminUpsertBulkStock({
    sku,
    name,
    quantityOnHandDelta: Number(quantityOnHandDelta),
    reorderLevel: reorderLevel ? Number(reorderLevel) : undefined,
  });

  res.status(200).json({
    message: "Bulk stock updated successfully.",
    data: stock,
  });
});

// ---------------------------------------------------------------------------
// Print Profiles & Templates Controllers
// ---------------------------------------------------------------------------

export const adminGetPrintProfileController = asyncHandler(async (req, res) => {
  const { sku } = req.params;
  if (!sku || Array.isArray(sku)) {
    throw new BadRequestError("Valid sku is required");
  }

  const profile = await (await import("./admin.inventory.services.js")).adminGetPrintProfile(sku);
  res.status(200).json({ data: profile });
});

export const adminUpsertPrintProfileController = asyncHandler(async (req, res) => {
  const { sku } = req.params;
  if (!sku || Array.isArray(sku)) {
    throw new BadRequestError("Valid sku is required");
  }

  const profile = await (await import("./admin.inventory.services.js")).adminUpsertPrintProfile({
    sku,
    ...req.body,
  });

  res.status(200).json({
    message: "Print profile updated successfully.",
    data: profile,
  });
});

export const adminCreatePrintTemplateController = asyncHandler(async (req, res) => {
  const { profileId } = req.params;
  if (!profileId || Array.isArray(profileId)) {
    throw new BadRequestError("Valid profileId is required");
  }

  const template = await (await import("./admin.inventory.services.js")).adminCreatePrintTemplate(
    profileId,
    req.body
  );

  res.status(201).json({
    message: "Print template created successfully.",
    data: template,
  });
});

// ---------------------------------------------------------------------------
// Print Batches & Warehouse Receiving Controllers
// ---------------------------------------------------------------------------

export const adminCreatePrintBatchController = asyncHandler(async (req, res) => {
  const { sku, quantity, vendorName, templateId, notes, dispatchImmediately } = req.body ?? {};

  if (!sku || typeof sku !== "string") {
    throw new BadRequestError("sku is required.");
  }
  if (!quantity || typeof quantity !== "number" || quantity <= 0) {
    throw new BadRequestError("quantity must be a positive integer.");
  }

  const result = await (await import("./admin.inventory.services.js")).adminCreatePrintBatch({
    sku,
    quantity,
    vendorName,
    templateId,
    notes,
    dispatchImmediately: dispatchImmediately !== false, // default true
  });

  res.status(201).json({
    message: `Print batch '${result.batchNumber}' created successfully with ${result.quantityRequested} tags.`,
    data: result,
  });
});

export const adminListPrintBatchesController = asyncHandler(async (req, res) => {
  const { page, limit, sku, status } = req.query;

  const result = await (await import("./admin.inventory.services.js")).adminListPrintBatches({
    page: page ? Number(page) : 1,
    limit: limit ? Number(limit) : 20,
    sku: typeof sku === "string" ? sku : undefined,
    status: typeof status === "string" ? (status as any) : undefined,
  });

  res.status(200).json(result);
});

export const adminGetPrintBatchController = asyncHandler(async (req, res) => {
  const { batchId } = req.params;
  if (!batchId || Array.isArray(batchId)) {
    throw new BadRequestError("Valid batchId is required");
  }

  const result = await (await import("./admin.inventory.services.js")).adminGetPrintBatchById(batchId);
  res.status(200).json({ data: result });
});

export const adminDispatchPrintBatchController = asyncHandler(async (req, res) => {
  const { batchId } = req.params;
  if (!batchId || Array.isArray(batchId)) {
    throw new BadRequestError("Valid batchId is required");
  }

  const { vendorName } = req.body ?? {};
  const result = await (await import("./admin.inventory.services.js")).adminDispatchPrintBatch(
    batchId,
    { vendorName }
  );

  res.status(200).json({
    message: `Print batch '${result.batchNumber}' successfully dispatched to printer.`,
    data: result,
  });
});

export const adminExportPrintBatchManifestController = asyncHandler(async (req, res) => {
  const { batchId } = req.params;
  if (!batchId || Array.isArray(batchId)) {
    throw new BadRequestError("Valid batchId is required");
  }

  const format = req.query.format === "csv" ? "csv" : "json";
  const result = await (await import("./admin.inventory.services.js")).adminExportPrintBatchManifest(
    batchId,
    format
  );

  if (format === "csv") {
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="print_manifest_${batchId}.csv"`);
    res.status(200).send(result);
    return;
  }

  res.status(200).json({ data: result });
});

export const adminInwardPrintBatchController = asyncHandler(async (req, res) => {
  const batchIdentifier = req.params.batchId || req.body?.batchIdentifier || req.body?.batchNumber;
  if (!batchIdentifier || Array.isArray(batchIdentifier)) {
    throw new BadRequestError("Valid batchIdentifier is required");
  }

  const {
    receivedCount,
    acceptedCount,
    defectiveCount,
    defectiveTagNumbers,
    markAsFinalShipment,
    notes,
    receivedBy,
    idempotencyKey,
  } = req.body ?? {};

  const result = await (await import("./admin.inventory.services.js")).adminInwardPrintBatch({
    batchIdentifier,
    receivedCount: receivedCount !== undefined ? Number(receivedCount) : undefined,
    acceptedCount: acceptedCount !== undefined ? Number(acceptedCount) : undefined,
    defectiveCount: defectiveCount !== undefined ? Number(defectiveCount) : undefined,
    defectiveTagNumbers,
    markAsFinalShipment: Boolean(markAsFinalShipment),
    notes,
    receivedBy,
    idempotencyKey,
  });

  res.status(200).json({
    message: result.isDuplicateRequest
      ? `Idempotent request: Batch '${result.batchNumber}' already received under receipt '${result.receiptNumber}'.`
      : `Warehouse inwarding processed for batch '${result.batchNumber}'. ${result.newlyAccepted} tags activated to IN_STOCK, ${result.newlyDefective} tags marked DAMAGED.`,
    data: result,
  });
});

export const adminReceivePrintBatchController = asyncHandler(async (req, res) => {
  const { batchId } = req.params;
  if (!batchId || Array.isArray(batchId)) {
    throw new BadRequestError("Valid batchId is required");
  }

  const { acceptedTagNumbers, defectiveTagNumbers, notes, idempotencyKey, receivedBy } = req.body ?? {};

  const result = await (await import("./admin.inventory.services.js")).adminReceivePrintBatch(
    batchId,
    {
      acceptedTagNumbers,
      defectiveTagNumbers,
      notes,
      idempotencyKey,
      receivedBy,
    }
  );

  res.status(200).json({
    message: `Warehouse receiving processed for batch '${result.batchNumber}'. ${result.newlyAccepted} tags activated to IN_STOCK, ${result.newlyDefective} tags marked DAMAGED.`,
    data: result,
  });
});
