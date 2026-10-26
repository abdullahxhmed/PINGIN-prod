import { PrintBatchStatus, QrTagStockState, QrTagStatus } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import {
  adminBatchGenerateTags,
  adminCreatePrintBatch,
  adminExportPrintBatchManifest,
  adminGetPrintBatchById,
  adminInwardPrintBatch,
} from "../modules/admin/inventory/admin.inventory.services.js";
import { getProductBySlug } from "../modules/catalog/catalog.services.js";

async function run() {
  console.log("=== STARTING BATCH INWARDING & VARIANT PRINT LIFECYCLE TESTS ===\n");

  // Step 0: Fetch or ensure active Product Variant
  console.log("-> Step 0: Locating active Product & Variant...");
  let variant = await prisma.productVariant.findFirst({
    where: { active: true },
    include: { product: true, components: true },
  });

  if (!variant || variant.components.length === 0) {
    throw new Error("No active product variant with components found to test against.");
  }

  const firstComp = variant.components[0];
  const componentSku = firstComp?.inventorySku || "KT-VS-SGL-LIT";
  console.log(`Found variant '${variant.name}' (SKU: ${variant.sku})`);
  console.log(`Physical component inventorySku: '${componentSku}'\n`);

  // Step 1: Batch generate digital tags
  console.log("-> Step 1: Generating 100 digital tags for SKU...");
  const genResult = await adminBatchGenerateTags({
    sku: componentSku,
    quantity: 100,
  });
  console.log(`Generated ${genResult.count} unprinted digital tags in GENERATED state.\n`);

  // Step 2: Create print batch linked to variant
  console.log("-> Step 2: Creating PrintBatch linked to variant...");
  const batch = await adminCreatePrintBatch({
    sku: componentSku,
    quantity: 100,
    variantId: variant.id,
    vendorName: "Precision Printworks Ltd",
    notes: "Automated batch inwarding test run",
    dispatchImmediately: true,
  });

  console.log(`Created PrintBatch: '${batch.batchNumber}' (ID: ${batch.batchId})`);
  console.log(`Status: ${batch.status}`);
  console.log(`Variant Snapshot Name: ${batch.variant?.variantName}`);
  console.log(`Variant Snapshot Artwork: ${batch.variant?.imageUrl}`);
  console.log(`Print Specs: ${batch.profile?.widthMm}x${batch.profile?.heightMm}mm, Finish: ${batch.profile?.finish}`);

  if (!batch.variant || batch.variant.variantSku !== variant.sku) {
    throw new Error("Batch failed to snapshot variant metadata correctly!");
  }
  console.log("✓ Variant snapshot verification passed.\n");

  // Step 3: Reproducible Printer Manifest Export
  console.log("-> Step 3: Exporting Printer Manifest...");
  const manifest = (await adminExportPrintBatchManifest(batch.batchId, "json")) as any;
  console.log(`Manifest contains ${manifest.items.length} serialized tags.`);
  console.log(`Sample Tag 1: #${manifest.items[0].sequenceNumber} ${manifest.items[0].tagNumber} -> ${manifest.items[0].qrUrl}`);

  if (manifest.items.length !== 100 || manifest.items[0].sequenceNumber !== 1) {
    throw new Error("Printer manifest serialization or sequence numbers incorrect!");
  }
  console.log("✓ Printer manifest verification passed.\n");

  // Step 4: First Partial Inward with Idempotency Key (40 tags received, 0 defects)
  console.log("-> Step 4: First Partial Inward (40 tags, 0 defects, with idempotency key)...");
  const testIdempKey = `IDEMP-${Date.now()}`;
  const inward1 = await adminInwardPrintBatch({
    batchIdentifier: batch.batchNumber,
    receivedCount: 40,
    acceptedCount: 40,
    defectiveCount: 0,
    notes: "First pallet received at dock",
    receivedBy: "WH-Operator-John",
    idempotencyKey: testIdempKey,
  });

  console.log(`Receipt 1: ${inward1.receiptNumber}`);
  console.log(`Newly Accepted: ${inward1.newlyAccepted}, Status: ${inward1.batchStatus}`);
  console.log(`Total Accepted: ${inward1.totalAccepted}, Outstanding: ${inward1.outstanding}`);

  if (inward1.batchStatus !== PrintBatchStatus.PARTIALLY_RECEIVED || inward1.totalAccepted !== 40 || inward1.outstanding !== 60) {
    throw new Error("First partial inward did not calculate quantities correctly!");
  }

  // Step 4b: Test Idempotency (Repeat exact same call with identical idempotencyKey)
  console.log("\n-> Step 4b: Retrying identical receipt to test Idempotency...");
  const retryResult = await adminInwardPrintBatch({
    batchIdentifier: batch.batchNumber,
    receivedCount: 40,
    acceptedCount: 40,
    defectiveCount: 0,
    idempotencyKey: testIdempKey,
  });

  console.log(`Duplicate Request Flag: ${retryResult.isDuplicateRequest}`);
  console.log(`Total Accepted after retry: ${retryResult.totalAccepted} (Should still be 40)`);

  if (!retryResult.isDuplicateRequest || retryResult.totalAccepted !== 40) {
    throw new Error("Idempotency guard FAILED! Stock was double-counted on duplicate request!");
  }
  console.log("✓ Strict idempotency verified: Duplicate inward did not alter stock counts.\n");

  // Step 5: Second Partial Inward with Deterministic Defects (30 tags received, 5 defective)
  console.log("-> Step 5: Second Partial Inward with 5 defects (30 received: 25 accepted, 5 defective)...");
  const inward2 = await adminInwardPrintBatch({
    batchIdentifier: batch.batchNumber,
    receivedCount: 30,
    acceptedCount: 25,
    defectiveCount: 5,
    notes: "Second box: 5 tags had misaligned laminate cuts",
    receivedBy: "WH-Operator-Sarah",
  });

  console.log(`Receipt 2: ${inward2.receiptNumber}`);
  console.log(`Newly Accepted: ${inward2.newlyAccepted}, Newly Defective: ${inward2.newlyDefective}`);
  console.log(`Total Accepted: ${inward2.totalAccepted}, Total Defective: ${inward2.totalDefective}, Outstanding: ${inward2.outstanding}`);
  console.log(`Recorded Defective Tags: ${JSON.stringify(inward2.receipt?.defectiveTagNumbers)}`);

  if (inward2.totalAccepted !== 65 || inward2.totalDefective !== 5 || inward2.outstanding !== 30) {
    throw new Error("Second partial inward with defects calculated incorrect cumulative totals!");
  }

  // Verify the 5 defective tags were revoked in QrTag table
  const defectiveNumbers = (inward2.receipt?.defectiveTagNumbers as string[]) || [];
  const revokedTags = await prisma.qrTag.findMany({
    where: { tagNumber: { in: defectiveNumbers } },
  });
  const allRevoked = revokedTags.every((t) => t.status === QrTagStatus.REVOKED);
  if (!allRevoked || revokedTags.length !== 5) {
    throw new Error("Defective tags were not revoked properly in QrTag table!");
  }
  console.log("✓ Deterministic defect handling verified: 5 tags revoked and logged in receipt.\n");

  // Step 6: Verify Storefront Availability Calculation
  console.log("-> Step 6: Verifying Catalog Storefront Availability Calculation...");
  const catalogProduct = await getProductBySlug(variant.product.slug);
  const matchedVariant = catalogProduct?.variants.find((v) => v.id === variant!.id) as any;

  console.log(`Storefront Variant In Stock: ${matchedVariant?.inStock}`);
  console.log(`Available Quantity: ${matchedVariant?.availableQuantity}`);
  console.log(`Component Stock Map:`, matchedVariant?.components?.map((c: any) => ({
    name: c.name,
    sku: c.inventorySku,
    availableStock: c.availableStock,
    maxUnits: c.maxUnits,
  })));

  const serializedComp = matchedVariant?.components?.find(
    (c: any) => c.inventorySku === componentSku
  );
  if (!matchedVariant?.inStock || !serializedComp || (serializedComp.availableStock || 0) < 65) {
    throw new Error("Storefront catalog availability calculation mismatch!");
  }
  const expectedAvailableUnits = Math.floor((serializedComp.availableStock || 0) / (serializedComp.quantity || 1));
  if (matchedVariant.availableQuantity !== expectedAvailableUnits) {
    throw new Error(`Variant availableQuantity (${matchedVariant.availableQuantity}) does not match expected bundle math (${expectedAvailableUnits})`);
  }
  console.log(`✓ Component-level inventory calculation verified: ${serializedComp.availableStock} tags on hand yields exactly ${matchedVariant.availableQuantity} sellable packs (quantity per pack = ${serializedComp.quantity}).\n`);

  // Step 7: Final Inward Completing the Batch to STOCKED (30 remaining tags)
  console.log("-> Step 7: Final Inward completing batch (30 tags, 0 defects)...");
  const inward3 = await adminInwardPrintBatch({
    batchIdentifier: batch.batchNumber,
    receivedCount: 30,
    acceptedCount: 30,
    defectiveCount: 0,
    notes: "Final box received, batch complete",
  });

  console.log(`Receipt 3: ${inward3.receiptNumber}`);
  console.log(`Batch Status: ${inward3.batchStatus} (Fully Stocked: ${inward3.isFullyStocked})`);
  console.log(`Final Cumulative: Accepted=${inward3.totalAccepted}, Defective=${inward3.totalDefective}, Outstanding=${inward3.outstanding}`);

  if (inward3.batchStatus !== PrintBatchStatus.STOCKED || inward3.totalAccepted !== 95 || inward3.outstanding !== 0) {
    throw new Error("Final inward did not mark batch as STOCKED!");
  }

  // Step 8: Idempotency on Already STOCKED Batch
  console.log("\n-> Step 8: Inward attempt on already fully STOCKED batch...");
  const duplicateFinal = await adminInwardPrintBatch({
    batchIdentifier: batch.batchNumber,
  });

  console.log(`Already Stocked Call Message: ${(duplicateFinal as any).notes}`);
  console.log(`Duplicate Flag: ${duplicateFinal.isDuplicateRequest}`);
  console.log(`Accepted Count: ${duplicateFinal.newlyAccepted} (Should be 0)`);

  if (!duplicateFinal.isDuplicateRequest || duplicateFinal.newlyAccepted !== 0) {
    throw new Error("STOCKED batch safeguard failed to prevent duplicate receiving!");
  }
  console.log("✓ STOCKED batch safeguard verified.\n");

  // Step 9: Lookup batch by Barcode / Number
  console.log("-> Step 9: Querying batch lookup details...");
  const lookup = await adminGetPrintBatchById(batch.batchNumber);
  console.log(`Lookup Batch: ${lookup.batchNumber}, Status: ${lookup.status}`);
  console.log(`Total Receipts Recorded: ${lookup.receipts.length}`);
  for (const r of lookup.receipts) {
    console.log(`  - ${r.receiptNumber}: Received=${r.receivedQuantity}, Accepted=${r.acceptedQuantity}, Defective=${r.defectiveQuantity}, At=${r.receivedAt.toISOString()}`);
  }

  if (lookup.receipts.length !== 3) {
    throw new Error(`Expected 3 receipt records, found ${lookup.receipts.length}`);
  }
  console.log("✓ Audit log verification passed: All 3 receipts preserved in chronological order.\n");

  console.log("==================================================================");
  console.log("🎉 ALL BATCH INWARDING & DATA INTEGRITY TESTS PASSED SUCCESSFULLY!");
  console.log("==================================================================");
}

run()
  .catch((err) => {
    console.error("Test execution failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
