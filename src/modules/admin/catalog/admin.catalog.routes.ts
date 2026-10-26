import { Router } from "express";
import {
  adminCreateProductController,
  adminCreateVariantController,
  adminDeleteProductController,
  adminDirectUploadImageController,
  adminGetProductByIdController,
  adminGetUploadSignedUrlController,
  adminListCatalogImagesController,
  adminListProductsController,
  adminToggleProductActiveController,
  adminUpdateProductController,
  adminUpdateVariantController,
} from "./admin.catalog.controllers.js";
import {
  adminBatchSyncStorefrontSlotsController,
  adminCreateStorefrontSlotController,
  adminDeleteStorefrontSlotController,
  adminGetStorefrontSlotHistoryController,
  adminListStorefrontSlotsController,
  adminUpdateStorefrontSlotController,
} from "./admin.storefront-slots.controllers.js";

const router = Router();

// Storefront Slots & Dynamic Layout Tracking
router.get("/slots", adminListStorefrontSlotsController);
router.post("/slots", adminCreateStorefrontSlotController);
router.put("/slots/batch-sync", adminBatchSyncStorefrontSlotsController);
router.get("/slots/history", adminGetStorefrontSlotHistoryController);
router.put("/slots/:slotKey", adminUpdateStorefrontSlotController);
router.patch("/slots/:slotKey", adminUpdateStorefrontSlotController);
router.delete("/slots/:slotKey", adminDeleteStorefrontSlotController);

// Image Management & Bucket Assets
router.get("/images", adminListCatalogImagesController);
router.post("/images/upload-url", adminGetUploadSignedUrlController);
router.post("/images/upload", adminDirectUploadImageController);


// Products CRUD
router.get("/products", adminListProductsController);
router.post("/products", adminCreateProductController);
router.get("/products/:id", adminGetProductByIdController);
router.put("/products/:id", adminUpdateProductController);
router.patch("/products/:id", adminUpdateProductController);
router.delete("/products/:id", adminDeleteProductController);
router.patch("/products/:id/active", adminToggleProductActiveController);

// Variants CRUD
router.post("/products/:id/variants", adminCreateVariantController);
router.put("/variants/:variantId", adminUpdateVariantController);
router.patch("/variants/:variantId", adminUpdateVariantController);

export default router;

