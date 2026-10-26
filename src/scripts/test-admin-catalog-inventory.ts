import "dotenv/config";
import { prisma } from "../lib/prisma.js";
import { ProductType, ComponentType, QrTagStockState } from "@prisma/client";
import {
  adminCreateProduct,
  adminGetProductById,
  adminListProducts,
  adminToggleProductActive,
} from "../modules/admin/catalog/admin.catalog.services.js";
import {
  adminBatchGenerateTags,
  adminGetInventorySummary,
  adminListBulkStock,
  adminListTagInventory,
  adminUpdateTagStockState,
  adminUpsertBulkStock,
} from "../modules/admin/inventory/admin.inventory.services.js";

async function main() {
  console.log("=== 1. Testing Admin Catalog: Product Creation with QR Tag Invariant ===");

  // A. Attempt to create a physical product WITHOUT a serialized QR tag -> Should fail!
  try {
    await adminCreateProduct({
      sku: "TEST-PROD-NO-QR",
      name: "Invalid Product Without Tag",
      slug: "invalid-product-no-qr",
      basePrice: 29900,
      variants: [
        {
          sku: "TEST-VAR-NO-QR",
          name: "Standard",
          price: 29900,
          components: [
            {
              componentType: ComponentType.PHYSICAL_ITEM,
              name: "Mounting Bracket",
              quantity: 1,
              inventorySku: "ACC-MOUNT-01",
            },
          ],
        },
      ],
    });
    throw new Error("Failed: Product creation should have thrown an error when QR tag is missing!");
  } catch (err: any) {
    console.log("✔ Validation passed: Rejected physical product without QR tag:", err.message);
  }

  // B. Create a new physical product type: e.g. "Bike Smart Tag" with bound QR tag
  const testProductSku = `TEST-BIKE-TAG-${Date.now()}`;
  const testProduct = await adminCreateProduct({
    sku: testProductSku,
    name: "Bike Smart Tag Kit",
    slug: `bike-smart-tag-${Date.now()}`,
    description: "Compact waterproof QR tag for bicycles and motorbikes.",
    type: ProductType.PHYSICAL_TAG_PACK,
    basePrice: 24900,
    weightGrams: 50,
    variants: [
      {
        sku: `${testProductSku}-STD`,
        name: "Standard Bike Kit",
        price: 24900,
        components: [
          {
            componentType: ComponentType.SERIALIZED_QR_TAG,
            name: "Waterproof Bike QR Tag",
            quantity: 1,
            inventorySku: "TAG-BIKE-WATERPROOF",
          },
          {
            componentType: ComponentType.DIGITAL_ENTITLEMENT,
            name: "12-Month Plus Plan",
            quantity: 1,
            plusDurationMonths: 12,
          },
        ],
      },
    ],
  });
  console.log(`✔ Created product: [${testProduct.sku}] ${testProduct.name} with ${testProduct.variants.length} variant.`);

  // C. List products
  const list = await adminListProducts({ limit: 5 });
  console.log(`✔ Total products listed: ${list.total}`);

  // D. Toggle active
  await adminToggleProductActive(testProduct.id, false);
  const updatedProduct = await adminGetProductById(testProduct.id);
  console.log(`✔ Product active status toggled: active = ${updatedProduct.active}`);

  console.log("\n=== 2. Testing Admin Inventory: Batch Generation Bound to SKU ===");
  // Generate 5 tags specifically bound to "TAG-BIKE-WATERPROOF"
  const batch = await adminBatchGenerateTags({
    sku: "TAG-BIKE-WATERPROOF",
    quantity: 5,
  });
  console.log(`✔ Generated batch of ${batch.count} tags bound to SKU '${batch.sku}':`);
  console.log(`   Sample tag number: ${batch.items[0]?.tagNumber}, QR URL: ${batch.items[0]?.qrUrl}`);

  // Check inventory list for this SKU
  const tagList = await adminListTagInventory({ sku: "TAG-BIKE-WATERPROOF", limit: 10 });
  console.log(`✔ Found ${tagList.total} tags in stock for SKU 'TAG-BIKE-WATERPROOF'`);
  const sampleTag = tagList.records[0]!;
  console.log(`   Sample tag ID: ${sampleTag.qrTagId}, State: ${sampleTag.stockState}, Operational: ${sampleTag.operationalStatus}`);

  // Update tag state to DAMAGED
  const updatedTag = await adminUpdateTagStockState(sampleTag.qrTagId, {
    state: QrTagStockState.DAMAGED,
    reason: "Damaged during packaging test",
  });
  console.log(`✔ Tag state updated: State = ${updatedTag.state}, Operational = ${updatedTag.qrTag.status}`);

  console.log("\n=== 3. Testing Admin Inventory Summary & Bulk Stock ===");
  // Upsert bulk stock
  await adminUpsertBulkStock({
    sku: "BOX-PACK-BIKE",
    name: "Custom Bike Packaging Box",
    quantityOnHandDelta: 200,
    reorderLevel: 25,
  });
  const bulkItems = await adminListBulkStock();
  const bikeBox = bulkItems.find((b) => b.sku === "BOX-PACK-BIKE");
  console.log(`✔ Bulk stock verified: [${bikeBox?.sku}] ${bikeBox?.name} -> Available: ${bikeBox?.availableCount}`);

  // Summary
  const summary = await adminGetInventorySummary();
  console.log("✔ Overall Inventory Summary:");
  console.log(`   Total physical tags: ${summary.totals.totalPhysicalTags}`);
  console.log(`   Total in commerce stock: ${summary.totals.inCommerceStock}`);
  console.log(`   Tracked serialized SKUs: ${summary.serializedBySku.length}`);
  for (const s of summary.serializedBySku) {
    console.log(`     - SKU [${s.sku}]: inStock=${s.inStock}, damaged=${s.damaged}, total=${s.total}`);
  }

  // Clean up test product
  await prisma.product.delete({ where: { id: testProduct.id } });
  console.log("\nAll Admin Catalog & Inventory tests passed successfully!");
}

main()
  .catch((e) => {
    console.error("Test failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
