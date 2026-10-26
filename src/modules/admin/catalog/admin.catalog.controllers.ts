import asyncHandler from "express-async-handler";
import { BadRequestError } from "../../../errors/AppError.js";
import {
  adminCreateProduct,
  adminCreateVariant,
  adminDeleteProduct,
  adminGetProductById,
  adminListProducts,
  adminToggleProductActive,
  adminUpdateProduct,
  adminUpdateVariant,
  createUploadSignedUrl,
  listCatalogImagesInBucket,
  uploadCatalogImageDirect,
} from "./admin.catalog.services.js";

export const adminListProductsController = asyncHandler(async (req, res) => {
  const { page, limit, search, type, activeOnly } = req.query;

  const result = await adminListProducts({
    page: page ? Number(page) : 1,
    limit: limit ? Number(limit) : 20,
    search: typeof search === "string" ? search : undefined,
    type: typeof type === "string" ? (type as any) : undefined,
    activeOnly: activeOnly === "true",
  });

  res.status(200).json(result);
});

export const adminGetProductByIdController = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!id || Array.isArray(id)) {
    throw new BadRequestError("Valid product id is required");
  }

  const product = await adminGetProductById(id);
  res.status(200).json({ data: product });
});

export const adminCreateProductController = asyncHandler(async (req, res) => {
  const product = await adminCreateProduct(req.body);
  res.status(201).json({
    message: "Product created successfully.",
    data: product,
  });
});

export const adminUpdateProductController = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!id || Array.isArray(id)) {
    throw new BadRequestError("Valid product id is required");
  }

  const product = await adminUpdateProduct(id, req.body);
  res.status(200).json({
    message: "Product updated successfully.",
    data: product,
  });
});

export const adminCreateVariantController = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!id || Array.isArray(id)) {
    throw new BadRequestError("Valid product id is required");
  }

  const variant = await adminCreateVariant(id, req.body);
  res.status(201).json({
    message: "Product variant created successfully.",
    data: variant,
  });
});

export const adminUpdateVariantController = asyncHandler(async (req, res) => {
  const { variantId } = req.params;
  if (!variantId || Array.isArray(variantId)) {
    throw new BadRequestError("Valid variantId is required");
  }

  const variant = await adminUpdateVariant(variantId, req.body);
  res.status(200).json({
    message: "Product variant updated successfully.",
    data: variant,
  });
});

export const adminToggleProductActiveController = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { active } = req.body;
  if (!id || Array.isArray(id)) {
    throw new BadRequestError("Valid product id is required");
  }
  if (typeof active !== "boolean") {
    throw new BadRequestError("active must be a boolean");
  }

  const result = await adminToggleProductActive(id, active);
  res.status(200).json({
    message: `Product ${active ? "activated" : "deactivated"} successfully.`,
    data: result,
  });
});

export const adminDeleteProductController = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!id || Array.isArray(id)) {
    throw new BadRequestError("Valid product id is required");
  }

  const result = await adminDeleteProduct(id);
  res.status(200).json(result);
});

export const adminListCatalogImagesController = asyncHandler(async (_req, res) => {
  const images = await listCatalogImagesInBucket();
  res.status(200).json({
    total: images.length,
    data: images,
  });
});

export const adminGetUploadSignedUrlController = asyncHandler(async (req, res) => {
  const { folder, filename, contentType } = req.body;
  if (!filename || typeof filename !== "string") {
    throw new BadRequestError("filename string is required");
  }

  const result = await createUploadSignedUrl({
    folder: typeof folder === "string" ? folder : "general",
    filename,
    contentType: typeof contentType === "string" ? contentType : "image/png",
  });

  res.status(200).json({
    message: "Signed upload URL generated successfully. Use HTTP PUT to upload the file to GCS.",
    data: result,
  });
});

export const adminDirectUploadImageController = asyncHandler(async (req, res) => {
  const { folder, filename, base64Data, contentType } = req.body;
  if (!filename || typeof filename !== "string") {
    throw new BadRequestError("filename string is required");
  }
  if (!base64Data || typeof base64Data !== "string") {
    throw new BadRequestError("base64Data string is required");
  }

  // Remove data URI prefix if present (e.g. data:image/png;base64,...)
  const cleanBase64 = base64Data.replace(/^data:[a-zA-Z0-9_\-\/]+;base64,/, "");
  const buffer = Buffer.from(cleanBase64, "base64");

  const result = await uploadCatalogImageDirect({
    folder: typeof folder === "string" ? folder : "general",
    filename,
    buffer,
    contentType: typeof contentType === "string" ? contentType : "image/png",
  });

  res.status(201).json({
    message: "Image uploaded successfully to Google Cloud Storage.",
    data: result,
  });
});
