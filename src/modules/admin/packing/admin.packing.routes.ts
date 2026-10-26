import { Router } from "express";
import {
  adminCancelPackingController,
  adminFinalizePackingController,
  adminGetPackingStatusController,
  adminScanTagController,
  adminStartPackingController,
} from "./admin.packing.controllers.js";

const router = Router({ mergeParams: true });

router.get("/", adminGetPackingStatusController);
router.post("/start", adminStartPackingController);
router.post("/scan", adminScanTagController);
router.post("/cancel", adminCancelPackingController);
router.post("/finalize", adminFinalizePackingController);

export default router;
