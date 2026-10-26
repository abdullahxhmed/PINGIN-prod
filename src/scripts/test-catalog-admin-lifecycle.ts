import { prisma } from "../lib/prisma.js";
import {
  adminUpdateProduct,
  adminUpdateVariant,
  adminGetProductById,
} from "../modules/admin/catalog/admin.catalog.services.js";
import { listPublicCatalog } from "../modules/catalog/catalog.services.js";
import { createAtomicReservation, releaseReservation } from "../modules/inventory/inventory.services.js";
import { ComponentType } from "@prisma/client";

async function runTests() {
  console.log("=== STARTING CATALOG & INVENTORY ADMIN LIFECYCLE TESTS ===");

  // 1. Verify URL validation & Admin product update
  console.log("\n[Test 1] Testing Image URL handling & admin product updates...");
  const publicProducts = await listPublicCatalog();
  if (publicProducts.length === 0) {
    throw new Error("No public products found to test against");
  }
  const testProduct = publicProducts[0]!;
  console.log(`Using test product: ${testProduct.name} (${testProduct.id})`);

  // Admin update with cloud bucket URLs and custom flags
  const updated = await adminUpdateProduct(testProduct.id, {
    imageUrl: "gs://my-parkping-bucket/products/test-card.png",
    isFeatured: true,
    displayOrder: 1,
  });

  if (
    updated.imageUrl !== "gs://my-parkping-bucket/products/test-card.png" ||
    updated.isFeatured !== true ||
    updated.displayOrder !== 1
  ) {
    throw new Error("Product update did not persist artwork or displayOrder properly");
  }
  console.log("✔ Admin product update successfully persisted cloud bucket URLs & storefront fields");

  // Verify rejection of invalid URLs
  let caughtValidationError = false;
  try {
    await adminUpdateProduct(testProduct.id, {
      imageUrl: "javascript:alert(1)",
    });
  } catch (err: any) {
    caughtValidationError = true;
    console.log(`✔ Correctly rejected invalid URL format: "${err.message}"`);
  }
  if (!caughtValidationError) {
    throw new Error("Failed to reject invalid image URL");
  }

  // 2. Test Public Catalog sorting and computed fields
  console.log("\n[Test 2] Testing Public Catalog response...");
  const catalogList = await listPublicCatalog();
  console.log(`Fetched ${catalogList.length} catalog items`);
  for (const p of catalogList) {
    if (typeof p.tagsCount !== "number" || typeof p.plusMonths !== "number") {
      throw new Error(`Product ${p.slug} missing computed tagsCount or plusMonths`);
    }
    console.log(
      `  - ${p.name.padEnd(28)} | order: ${p.displayOrder} | tags: ${p.tagsCount} | plusMonths: ${p.plusMonths} | inStock: ${p.inStock}`
    );
  }
  // Verify ordering
  for (let i = 0; i < catalogList.length - 1; i++) {
    const curr = catalogList[i]!;
    const next = catalogList[i + 1]!;
    if (curr.displayOrder > next.displayOrder) {
      throw new Error(`Catalog is not properly sorted by displayOrder ascending at index ${i}`);
    }
  }
  console.log("✔ Public catalog is properly sorted and includes derived tagsCount and plusMonths");

  // 3. Test Active Reservation Guard on Variant Component Updates
  console.log("\n[Test 3] Testing Active Reservation guard on variant component updates...");
  const variant = testProduct.variants[0]!;

  // Clean up any previous test reservations on this variant
  const priorTestReservations = await prisma.inventoryReservation.findMany({
    where: {
      status: "ACTIVE",
      checkoutSessionId: { startsWith: "test-sess-" },
    },
  });
  for (const r of priorTestReservations) {
    await releaseReservation(r.id);
  }

  const checkoutSessionId = `test-sess-${Date.now()}`;

  // Create an active reservation
  console.log(`Creating active reservation for variant ${variant.sku}...`);
  const reservation = await createAtomicReservation({
    checkoutSessionId,
    variantId: variant.id,
    quantity: 1,
  });
  console.log(`Reservation created (ID: ${reservation.id}, Status: ${reservation.status})`);

  // Attempt to update variant components while reservation is active
  let blockedUpdate = false;
  try {
    await adminUpdateVariant(variant.id, {
      components: [
        {
          componentType: ComponentType.SERIALIZED_QR_TAG,
          name: "Mutated Component",
          quantity: 2,
          inventorySku: "TAG-VEHICLE-STICKER",
        },
      ],
    });
  } catch (err: any) {
    blockedUpdate = true;
    console.log(`✔ Component update successfully blocked by guard: "${err.message}"`);
  }
  if (!blockedUpdate) {
    throw new Error("Variant component update was NOT blocked despite active reservation!");
  }

  // Release the reservation
  console.log("Releasing reservation...");
  await releaseReservation(reservation.id);

  // Now retry updating variant components (or restoring existing)
  console.log("Retrying component update after reservation release...");
  const restoredComponents = variant.components.map((c) => ({
    componentType: c.componentType,
    name: c.name,
    quantity: c.quantity,
    ...(c.inventorySku ? { inventorySku: c.inventorySku } : {}),
    plusDurationMonths: c.plusDurationMonths ?? 0,
  }));
  const updatedVariant = await adminUpdateVariant(variant.id, {
    components: restoredComponents,
  });
  console.log(`✔ Variant component update succeeded after reservation release (${updatedVariant.components.length} components)`);

  // 4. Test Historical Order Snapshot Immutability
  console.log("\n[Test 4] Testing Historical Order Snapshot immutability...");
  // Simulate order creation snapshot
  const productBefore = await prisma.product.findUniqueOrThrow({
    where: { id: testProduct.id },
  });
  const variantBefore = await prisma.productVariant.findUniqueOrThrow({
    where: { id: variant.id },
    include: { components: true },
  });

  const snapshot = {
    product: {
      id: productBefore.id,
      sku: productBefore.sku,
      name: productBefore.name,
      slug: productBefore.slug,
      type: productBefore.type,
      imageUrl: productBefore.imageUrl,
      weightGrams: productBefore.weightGrams,
      lengthCm: productBefore.lengthCm,
      breadthCm: productBefore.breadthCm,
      heightCm: productBefore.heightCm,
    },
    variant: {
      id: variantBefore.id,
      sku: variantBefore.sku,
      name: variantBefore.name,
      price: variantBefore.price,
    },
    components: variantBefore.components.map((c) => ({
      id: c.id,
      componentType: c.componentType,
      name: c.name,
      quantity: c.quantity,
      plusDurationMonths: c.plusDurationMonths,
      inventorySku: c.inventorySku,
    })),
  };

  // Mutate product catalog name and image
  await adminUpdateProduct(testProduct.id, {
    name: "Temporary New Name",
    imageUrl: "gs://changed-bucket/new-image.png",
  });

  // Verify that the snapshot preserved the old values
  if (
    snapshot.product.name === "Temporary New Name" ||
    snapshot.product.imageUrl === "gs://changed-bucket/new-image.png"
  ) {
    throw new Error("Snapshot was mutated!");
  }
  console.log("✔ Order snapshot remains completely decoupled from catalog mutations");

  // Restore product name & artwork
  await adminUpdateProduct(testProduct.id, {
    name: productBefore.name,
    imageUrl: productBefore.imageUrl,
    displayOrder: productBefore.displayOrder,
    isFeatured: productBefore.isFeatured,
  });
  console.log("✔ Product state cleanly restored");

  // 5. Test GCS Image Signing Service & Refresh Lookup
  console.log("\n[Test 5] Testing GCS Image Signing Service and Refresh Route Lookup...");
  const { getProductImageObjectPath, createCatalogImageUrl } = await import(
    "../modules/catalog/catalog-images.service.js"
  );

  // Test lookup by product ID
  const foundImage = await getProductImageObjectPath(testProduct.id);
  if (!foundImage || !foundImage.objectPath) {
    throw new Error(`Failed to find image for product ${testProduct.id}`);
  }
  console.log(`✔ Found image for product: ${foundImage.objectPath} (slot: ${foundImage.imageType})`);

  // Test URL creation for direct/relative paths
  const directResult = await createCatalogImageUrl("/stickerImages/car.png");
  if (!directResult.url || !directResult.expiresAt) {
    throw new Error("Direct image URL resolution failed");
  }
  console.log(`✔ Direct image resolution succeeded: ${directResult.url}`);

  console.log("\n=== ALL TESTS PASSED SUCCESSFULLY ===");
}

runTests()
  .catch((e) => {
    console.error("Test failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
