import "dotenv/config";
import { prisma } from "../lib/prisma.js";
import {
  adminBatchGenerateTags,
  adminCreatePrintBatch,
  adminExportPrintBatchManifest,
  adminGetInventorySummary,
  adminGetPrintProfile,
  adminReceivePrintBatch,
} from "../modules/admin/inventory/admin.inventory.services.js";
import { listPublicCatalog, seedDefaultCatalog } from "../modules/catalog/catalog.services.js";
import { PrintBatchStatus, QrTagStockState } from "@prisma/client";

async function main() {
  console.log("==================================================================");
  console.log("🚀 Testing Print Lifecycle: Generation -> Batch -> Receiving");
  console.log("==================================================================\n");

  await seedDefaultCatalog();

  const testSku = "TAG-VEHICLE-STICKER";

  // Step 1: Ensure Print Profile & Template exist
  console.log("[1] Checking approved Print Profile & Template for SKU:", testSku);
  const profile = await adminGetPrintProfile(testSku);
  console.log(`    Profile: ${profile.name} (${profile.widthMm}x${profile.heightMm}mm, ${profile.material})`);
  console.log(`    Templates count: ${profile.templates.length}, Default: ${profile.templates[0]?.name}`);

  // Step 2: Check initial storefront stock
  const catalogBefore = await listPublicCatalog();
  const vehicleProduct = catalogBefore.find((p) => p.sku === "PK-VEHICLE-STICKER");
  const initialAvailable = vehicleProduct?.variants[0]?.availableQuantity ?? 0;
  console.log(`\n[2] Initial storefront sellable stock for ${testSku}: ${initialAvailable} units`);

  // Step 3: Digital Generation (Generate 20 tags)
  console.log("\n[3] Generating 20 digital tags (Tokens & hashes in DB)...");
  const genResult = await adminBatchGenerateTags({
    sku: testSku,
    quantity: 20,
  });
  console.log(`    Created ${genResult.count} digital tags. Sample tag: ${genResult.items[0]?.tagNumber}`);

  // Verify that all 20 are in GENERATED state
  const generatedCount = await prisma.qrTagInventory.count({
    where: { sku: testSku, state: QrTagStockState.GENERATED },
  });
  console.log(`    Unprinted tags in GENERATED state: ${generatedCount}`);

  // Verify storefront stock has NOT changed!
  const catalogAfterGen = await listPublicCatalog();
  const vehicleAfterGen = catalogAfterGen.find((p) => p.sku === "PK-VEHICLE-STICKER");
  const availableAfterGen = vehicleAfterGen?.variants[0]?.availableQuantity ?? 0;
  console.log(`    Storefront stock after generation: ${availableAfterGen} units`);
  if (availableAfterGen !== initialAvailable) {
    throw new Error(`CRITICAL: Storefront stock increased on digital generation! Expected ${initialAvailable}, got ${availableAfterGen}`);
  }
  console.log("    ✅ Invariant verified: Digital generation does NOT increase sellable stock!");

  // Step 4: Create Print Batch for 15 tags
  console.log("\n[4] Creating Print Batch for 15 tags and dispatching to printer...");
  const batch = await adminCreatePrintBatch({
    sku: testSku,
    quantity: 15,
    vendorName: "Precision Print Labs",
    notes: "E2E automated test batch",
    dispatchImmediately: true,
  });
  console.log(`    Batch Number: ${batch.batchNumber}`);
  console.log(`    Status: ${batch.status}`);
  console.log(`    Tags assigned: ${batch.tagCount}`);

  // Verify tags moved to SENT_TO_PRINT
  const inPrintCount = await prisma.qrTagInventory.count({
    where: { printBatchId: batch.batchId, state: QrTagStockState.SENT_TO_PRINT },
  });
  console.log(`    Batch tags in SENT_TO_PRINT: ${inPrintCount}`);

  // Verify storefront stock is STILL unchanged
  const catalogAfterBatch = await listPublicCatalog();
  const vehicleAfterBatch = catalogAfterBatch.find((p) => p.sku === "PK-VEHICLE-STICKER");
  const availableAfterBatch = vehicleAfterBatch?.variants[0]?.availableQuantity ?? 0;
  console.log(`    Storefront stock while in PRINTING: ${availableAfterBatch} units`);
  if (availableAfterBatch !== initialAvailable) {
    throw new Error(`CRITICAL: Storefront stock changed when batch was sent to print!`);
  }
  console.log("    ✅ Invariant verified: Printing tags do NOT count as sellable stock!");

  // Step 5: Export Manifest
  console.log("\n[5] Exporting Print Manifest for vendor...");
  const manifestJson = (await adminExportPrintBatchManifest(batch.batchId, "json")) as any;
  console.log(`    Manifest tags count: ${manifestJson.items.length}`);
  console.log(`    Sample QR Url: ${manifestJson.items[0]?.qrUrl}`);

  const batchTags = manifestJson.items.map((i: any) => i.tagNumber);
  const partialAccepted = batchTags.slice(0, 10);
  const partialDefective = batchTags.slice(10, 12);
  const remainingTags = batchTags.slice(12);

  // Step 6: Warehouse Partial Receiving (10 accepted, 2 defective)
  console.log("\n[6] Warehouse Partial Receiving: 10 Accepted, 2 Defective (12 of 15 total)...");
  const receiveResult1 = await adminReceivePrintBatch(batch.batchId, {
    acceptedTagNumbers: partialAccepted,
    defectiveTagNumbers: partialDefective,
    notes: "First delivery box arrived",
  });
  console.log(`    Batch status: ${receiveResult1.batchStatus}`);
  console.log(`    Received: ${receiveResult1.totalReceived}, Defective: ${receiveResult1.totalDefective}, Outstanding: ${receiveResult1.outstanding}`);

  if (receiveResult1.batchStatus !== PrintBatchStatus.PARTIALLY_RECEIVED) {
    throw new Error(`Expected batch to transition to PARTIALLY_RECEIVED on partial delivery, got: ${receiveResult1.batchStatus}`);
  }

  // Verify storefront stock increased by EXACTLY 10!
  const catalogAfterRec1 = await listPublicCatalog();
  const vehicleAfterRec1 = catalogAfterRec1.find((p) => p.sku === "PK-VEHICLE-STICKER");
  const availableAfterRec1 = vehicleAfterRec1?.variants[0]?.availableQuantity ?? 0;
  console.log(`    Storefront stock after receiving 10 tags: ${availableAfterRec1} units`);
  if (availableAfterRec1 !== initialAvailable + 10) {
    throw new Error(`Expected storefront stock to be ${initialAvailable + 10}, got ${availableAfterRec1}`);
  }
  console.log("    ✅ Storefront stock increased by exactly the accepted quantity (+10)!");

  // Step 7: Warehouse Final Receiving (Remaining 3 tags accepted)
  console.log("\n[7] Warehouse Final Receiving: Remaining 3 Accepted tags...");
  const receiveResult2 = await adminReceivePrintBatch(batch.batchId, {
    acceptedTagNumbers: remainingTags,
    notes: "Second delivery box arrived, batch complete",
  });
  console.log(`    Batch status: ${receiveResult2.batchStatus}`);
  console.log(`    Total Received: ${receiveResult2.totalReceived}, Total Defective: ${receiveResult2.totalDefective}`);
  console.log(`    Outstanding: ${receiveResult2.outstanding}`);
  console.log(`    Is Fully Stocked: ${receiveResult2.isFullyStocked}`);

  if (receiveResult2.batchStatus !== PrintBatchStatus.STOCKED) {
    throw new Error(`Expected batch to transition to STOCKED, got ${receiveResult2.batchStatus}`);
  }

  // Verify storefront stock increased by another 3 (total +13 accepted)
  const catalogFinal = await listPublicCatalog();
  const vehicleFinal = catalogFinal.find((p) => p.sku === "PK-VEHICLE-STICKER");
  const availableFinal = vehicleFinal?.variants[0]?.availableQuantity ?? 0;
  console.log(`    Final storefront stock: ${availableFinal} units`);
  if (availableFinal !== initialAvailable + 13) {
    throw new Error(`Expected final stock ${initialAvailable + 13}, got ${availableFinal}`);
  }
  console.log("    ✅ Final Invariant verified: All 13 accepted tags are live and sellable!");

  // Step 8: Check inventory summary
  console.log("\n[8] Checking Admin Inventory Summary breakdown...");
  const summary = await adminGetInventorySummary();
  const skuSummary = summary.serializedBySku.find((s) => s.sku === testSku);
  console.log("    SKU Breakdown:", skuSummary);

  console.log("\n==================================================================");
  console.log("🎉 ALL TESTS PASSED SUCCESSFULLY!");
  console.log("==================================================================");
}

main()
  .catch((e) => {
    console.error("Test failed with error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
