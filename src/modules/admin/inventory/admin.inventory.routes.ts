import { Router } from "express";
import {
  adminBatchGenerateTagsController,
  adminCreatePrintBatchController,
  adminCreatePrintTemplateController,
  adminDispatchPrintBatchController,
  adminExportPrintBatchManifestController,
  adminGetInventorySummaryController,
  adminGetPrintBatchController,
  adminGetPrintProfileController,
  adminListBulkStockController,
  adminListPrintBatchesController,
  adminListTagInventoryController,
  adminReceivePrintBatchController,
  adminInwardPrintBatchController,
  adminUpdateTagStockStateController,
  adminUpsertBulkStockController,
  adminUpsertPrintProfileController,
} from "./admin.inventory.controllers.js";

const router = Router();

// Inventory overview & serialized tags
router.get("/summary", adminGetInventorySummaryController);
router.get("/tags", adminListTagInventoryController);
router.post("/tags/batch", adminBatchGenerateTagsController);
router.patch("/tags/:tagId/state", adminUpdateTagStockStateController);

// Print Profiles & Design Templates
router.get("/print-profiles/:sku", adminGetPrintProfileController);
router.put("/print-profiles/:sku", adminUpsertPrintProfileController);
router.post("/print-profiles/:profileId/templates", adminCreatePrintTemplateController);

// Production Batches (GENERATED -> PRINTING -> PARTIALLY_RECEIVED -> STOCKED)
router.post("/print-batches", adminCreatePrintBatchController);
router.get("/print-batches", adminListPrintBatchesController);
router.get("/print-batches/lookup/:batchId", adminGetPrintBatchController);
router.get("/print-batches/:batchId", adminGetPrintBatchController);
router.post("/print-batches/:batchId/dispatch", adminDispatchPrintBatchController);
router.get("/print-batches/:batchId/export", adminExportPrintBatchManifestController);
router.post("/print-batches/:batchId/receive", adminReceivePrintBatchController);
router.post("/print-batches/:batchId/inward", adminInwardPrintBatchController);
router.post("/print-batches/inward", adminInwardPrintBatchController);

// Bulk items
router.get("/bulk-stock", adminListBulkStockController);
router.post("/bulk-stock", adminUpsertBulkStockController);

export default router;
