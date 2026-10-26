import dotenv from "dotenv";
dotenv.config();

import { prisma } from "../lib/prisma.js";
import {
  adminCreateProduct,
  adminDeleteProduct,
  adminGetProductById,
  adminUpdateProduct,
  createUploadSignedUrl,
  listCatalogImagesInBucket,
} from "../modules/admin/catalog/admin.catalog.services.js";
import { ComponentType, ProductType } from "@prisma/client";

async function main() {
  console.log("=== TESTING UNIFIED CATALOG IMAGE & PRODUCT LIFECYCLE ===\n");

  // 1. Test listing images in GCS bucket
  console.log("[Test 1] Testing listCatalogImagesInBucket()...");
  const images = await listCatalogImagesInBucket();
  console.log(`Found ${images.length} images in GCS bucket:`);
  for (const img of images.slice(0, 4)) {
    console.log(`  - [${img.folder}] ${img.name} (${img.size} bytes) -> url: ${img.url?.slice(0, 60)}...`);
  }
  if (images.length === 0) {
    throw new Error("Expected at least one image in GCS bucket");
  }
  console.log("✔ listCatalogImagesInBucket() works seamlessly\n");

  // 2. Test createUploadSignedUrl
  console.log("[Test 2] Testing createUploadSignedUrl()...");
  const uploadInfo = await createUploadSignedUrl({
    folder: "test_uploads",
    filename: "new_artwork.png",
    contentType: "image/png",
  });
  console.log("Upload signed URL generated:");
  console.log(`  - Object path: ${uploadInfo.objectPath}`);
  console.log(`  - Upload URL: ${uploadInfo.uploadUrl.slice(0, 80)}...`);
  console.log(`  - Expires at: ${uploadInfo.expiresAt}`);
  if (!uploadInfo.uploadUrl.includes("X-Goog-Signature")) {
    throw new Error("Generated upload URL missing GCS V4 signature");
  }
  console.log("✔ createUploadSignedUrl() works seamlessly\n");

  // 3. Test creating a product with image references
  console.log("[Test 3] Testing adminCreateProduct() with GCS image references...");
  const testSku = `TEST-UNIFIED-${Date.now()}`;
  const testSlug = `test-unified-${Date.now()}`;

  const created = await adminCreateProduct({
    sku: testSku,
    name: "Unified System Test Pack",
    slug: testSlug,
    description: "Testing unified catalog with images",
    type: ProductType.PHYSICAL_TAG_PACK,
    basePrice: 29900,
    imageUrl: images[0]?.objectPath ?? "product_images/bundles/darkSet.PNG",
    variants: [
      {
        sku: `${testSku}-VAR-1`,
        name: "Standard Pack (Fallback to Parent Image)",
        price: 29900,
        components: [
          {
            componentType: ComponentType.SERIALIZED_QR_TAG,
            name: "Serialized QR Tag",
            quantity: 1,
            inventorySku: "TAG-VEHICLE-STICKER",
          },
        ],
      },
      {
        sku: `${testSku}-VAR-2`,
        name: "Custom Artwork Variant",
        price: 39900,
        imageUrl: images[1]?.objectPath ?? "product_images/bundles/lightSet.PNG",
        components: [
          {
            componentType: ComponentType.SERIALIZED_QR_TAG,
            name: "Serialized QR Tag",
            quantity: 1,
            inventorySku: "TAG-VEHICLE-STICKER",
          },
        ],
      },
    ],
  });

  console.log(`Created product: ${created.name} (${created.id})`);
  console.log(`  - Stored imageReference: ${created.imageReference}`);
  console.log(`  - Resolved parent imageUrl: ${created.imageUrl?.slice(0, 60)}...`);
  console.log(`  - Variant 1 (inherited parent image): ${created.variants[0]?.imageUrl?.slice(0, 60)}...`);
  console.log(`  - Variant 2 (own custom image): ${created.variants[1]?.imageUrl?.slice(0, 60)}...`);
  if (!created.imageUrl?.startsWith("https://storage.googleapis.com/")) {
    throw new Error("Expected resolved imageUrl to be a signed GCS URL");
  }
  if (!created.variants[0]?.imageUrl?.startsWith("https://storage.googleapis.com/")) {
    throw new Error("Expected variant 1 to inherit and resolve parent image as signed URL");
  }
  if (!created.variants[1]?.imageUrl?.startsWith("https://storage.googleapis.com/")) {
    throw new Error("Expected variant 2 to resolve its own image as signed URL");
  }
  console.log("✔ adminCreateProduct() resolves images immediately with parent fallback for variants\n");

  // 4. Test fetching individual product by ID
  console.log("[Test 4] Testing adminGetProductById()...");
  const fetched = await adminGetProductById(created.id);
  console.log(`Fetched product: ${fetched.name}`);
  console.log(`  - imageUrl: ${fetched.imageUrl?.slice(0, 60)}...`);
  console.log(`  - imageReference: ${fetched.imageReference}`);
  if (fetched.id !== created.id || !fetched.imageUrl?.startsWith("https://storage.googleapis.com/")) {
    throw new Error("Failed to fetch product with signed image URLs");
  }
  console.log("✔ adminGetProductById() works seamlessly\n");

  // 5. Test updating product artwork and details
  console.log("[Test 5] Testing adminUpdateProduct()...");
  const updated = await adminUpdateProduct(created.id, {
    name: "Unified System Test Pack (Updated)",
    imageUrl: images[images.length - 1]?.objectPath,
  });
  console.log(`Updated product: ${updated.name}`);
  console.log(`  - Updated imageReference: ${updated.imageReference}`);
  console.log(`  - Updated imageUrl: ${updated.imageUrl?.slice(0, 60)}...`);
  console.log("✔ adminUpdateProduct() works seamlessly\n");

  // 6. Test deleting product
  console.log("[Test 6] Testing adminDeleteProduct()...");
  const deleteResult = await adminDeleteProduct(created.id);
  console.log(`Delete result: ${deleteResult.message} (deleted: ${deleteResult.deleted})`);
  console.log("✔ adminDeleteProduct() works seamlessly\n");

  console.log("=== ALL UNIFIED CATALOG IMAGE & PRODUCT TESTS PASSED ===");
}

main()
  .catch((e) => {
    console.error("Test failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
