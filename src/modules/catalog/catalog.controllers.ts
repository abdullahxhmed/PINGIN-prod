import asyncHandler from "express-async-handler";
import { BadRequestError } from "../../errors/AppError.js";
import { getProductBySlug, getPublicStorefrontSlots, listPublicCatalog } from "./catalog.services.js";
import {
  createCatalogImageUrl,
  getProductImageObjectPath,
} from "./catalog-images.service.js";

export const listCatalogController = asyncHandler(async (_req, res) => {
  const products = await listPublicCatalog();
  const slots = (products as any).slots || {};
  res.status(200).json({
    data: products,
    slots,
  });
});

export const getStorefrontSlotsPublicController = asyncHandler(async (_req, res) => {
  const result = await getPublicStorefrontSlots();
  res.status(200).json({
    data: result.slots,
    slots: result.slots,
    activeSlots: result.activeSlots,
    products: result.products,
  });
});


export const getProductBySlugController = asyncHandler(async (req, res) => {
  const { slug } = req.params;
  if (!slug || Array.isArray(slug)) {
    throw new BadRequestError("Invalid product slug");
  }
  const product = await getProductBySlug(slug);
  res.status(200).json({
    data: product,
  });
});

export const getCatalogImageUrlController = asyncHandler(async (req, res) => {
  const { imageId } = req.params;
  const imageType = typeof req.query.type === "string" ? req.query.type : undefined;

  if (!imageId || Array.isArray(imageId)) {
    throw new BadRequestError("Invalid image ID");
  }

  const image = await getProductImageObjectPath(imageId, imageType);

  if (!image) {
    res.status(404).json({
      message: "Catalog image not found",
    });
    return;
  }

  const signed = await createCatalogImageUrl(image.objectPath);
  res.status(200).json(signed);
});


