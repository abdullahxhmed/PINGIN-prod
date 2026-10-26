import { Router } from "express";
import {
  getCatalogImageUrlController,
  getProductBySlugController,
  getStorefrontSlotsPublicController,
  listCatalogController,
} from "./catalog.controllers.js";

const router = Router();

router.get("/images/:imageId/url", getCatalogImageUrlController);
router.get("/slots", getStorefrontSlotsPublicController);
router.get("/", listCatalogController);
router.get("/:slug", getProductBySlugController);


export default router;
