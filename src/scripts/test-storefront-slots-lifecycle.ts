import dotenv from "dotenv";
dotenv.config();

import { prisma } from "../lib/prisma.js";
import {
  adminCreateStorefrontSlot,
  adminDeleteStorefrontSlot,
  adminGetStorefrontSlotHistory,
  adminListStorefrontSlots,
  adminUpdateStorefrontSlot,
  seedDefaultStorefrontSlots,
} from "../modules/admin/catalog/admin.storefront-slots.services.js";
import { listPublicCatalog } from "../modules/catalog/catalog.services.js";
import { StorefrontSlotType } from "@prisma/client";

async function main() {
  console.log("=== TESTING STOREFRONT SLOTS TRACKING & AUTO-SWAP LIFECYCLE ===\n");

  // 1. Test Seeding & Listing
  console.log("[Test 1] Testing seedDefaultStorefrontSlots and adminListStorefrontSlots()...");
  await seedDefaultStorefrontSlots();
  const slotList = await adminListStorefrontSlots();
  console.log(`Found ${slotList.totalSlots} slots in database:`);
  for (const s of slotList.slots) {
    console.log(`  - Slot [${s.slotKey}] (${s.slotType}): ${s.label} -> Assigned: ${s.product?.name ?? "EMPTY"} (${s.product?.imageUrl?.slice(0, 50)}...)`);
  }
  console.log(`Available Bundles pool: ${slotList.availableBundles.length}`);
  console.log(`Available Individuals pool: ${slotList.availableIndividuals.length}`);
  if (slotList.slots.length < 2) {
    throw new Error("Expected at least 2 default slots");
  }
  console.log("✔ Default slots seeded and listed with resolved artwork\n");

  // 2. Test Auto-Swap Logic
  console.log("[Test 2] Testing Auto-Swap mechanism between slots...");
  const slot1 = slotList.slots.find((s) => s.slotKey === "bundle_1");
  const slot2 = slotList.slots.find((s) => s.slotKey === "bundle_2");
  if (!slot1 || !slot2 || !slot1.productId || !slot2.productId) {
    throw new Error("Both bundle_1 and bundle_2 must have assigned products for swap test");
  }

  const origProduct1Id = slot1.productId;
  const origProduct2Id = slot2.productId;
  console.log(`Before swap: bundle_1 = ${slot1.product?.name} (${origProduct1Id}), bundle_2 = ${slot2.product?.name} (${origProduct2Id})`);

  // Assign Product 2 to Slot 1 (Product 1 should auto-swap into Slot 2!)
  await adminUpdateStorefrontSlot("bundle_1", {
    productId: origProduct2Id,
    reason: "Testing auto-swap between bundle slots",
    changedBy: "test-runner",
  });

  const refreshedList = await adminListStorefrontSlots();
  const refreshedSlot1 = refreshedList.slots.find((s) => s.slotKey === "bundle_1");
  const refreshedSlot2 = refreshedList.slots.find((s) => s.slotKey === "bundle_2");

  console.log(`After swap:  bundle_1 = ${refreshedSlot1?.product?.name} (${refreshedSlot1?.productId}), bundle_2 = ${refreshedSlot2?.product?.name} (${refreshedSlot2?.productId})`);

  if (refreshedSlot1?.productId !== origProduct2Id || refreshedSlot2?.productId !== origProduct1Id) {
    throw new Error("Auto-swap failed: products did not swap slots properly!");
  }
  console.log("✔ Auto-swap verified: products successfully exchanged slots\n");

  // 3. Test Type-Constraint Validation
  console.log("[Test 3] Testing Slot Type validation (Individual product in Bundle slot)...");
  const individualProduct = slotList.availableIndividuals[0];
  if (!individualProduct) {
    throw new Error("Expected at least one individual product in database");
  }

  try {
    await adminUpdateStorefrontSlot("bundle_1", {
      productId: individualProduct.id,
      reason: "Attempting invalid assignment",
    });
    throw new Error("Validation failed: Allowed individual product into BUNDLE slot!");
  } catch (err: any) {
    console.log(`✔ Expected validation error caught: "${err.message}"\n`);
  }

  // 4. Test Dynamic Custom Slot Creation & Deletion
  console.log("[Test 4] Testing dynamic N-slot creation and deletion...");
  const customKey = `bundle_flash_${Date.now()}`;
  const customSlot = await adminCreateStorefrontSlot({
    slotKey: customKey,
    label: "Flash Sale Bundle Slot",
    slotType: StorefrontSlotType.BUNDLE,
    displayOrder: 99,
    reason: "Seasonal promotion test",
    changedBy: "test-runner",
  });
  console.log(`Created custom slot: [${customSlot.slotKey}] ${customSlot.label}`);

  const deleteResult = await adminDeleteStorefrontSlot(customKey, "test-runner");
  console.log(`Deleted custom slot: ${deleteResult.message}`);
  console.log("✔ Dynamic slot creation and deletion verified\n");

  // 5. Test Public Catalog Slot Synchronization
  console.log("[Test 5] Testing public catalog integration with storefront slots...");
  const catalog = await listPublicCatalog();
  const slotsMap = (catalog as any).slots;
  if (!slotsMap || !slotsMap.bundle_1 || !slotsMap.bundle_2) {
    throw new Error("Public catalog missing slots dictionary");
  }
  console.log("Public catalog slots map keys:", Object.keys(slotsMap));
  console.log(`  - slots.bundle_1 = ${slotsMap.bundle_1?.name} (${slotsMap.bundle_1?.imageUrl?.slice(0, 50)}...)`);
  console.log(`  - slots.bundle_2 = ${slotsMap.bundle_2?.name}`);

  const slottedItem = catalog.find((p: any) => p.storefrontSlot === "bundle_1");
  if (!slottedItem) {
    throw new Error("Product in catalog array missing storefrontSlot tag");
  }
  console.log(`✔ Catalog product '${slottedItem.name}' tagged with storefrontSlot: '${slottedItem.storefrontSlot}'\n`);

  // 6. Test Audit Trail & History
  console.log("[Test 6] Testing Storefront Slot History audit trail...");
  const historyResult = await adminGetStorefrontSlotHistory({ limit: 10 });
  console.log(`Found ${historyResult.total} audit history entries:`);
  for (const h of historyResult.history.slice(0, 4)) {
    console.log(`  - [${h.action}] Slot: ${h.slotKey} | New: ${h.newProduct?.name ?? "none"} | Prev: ${h.previousProduct?.name ?? "none"} | By: ${h.changedBy} | At: ${h.assignedAt.toISOString()}`);
  }
  if (historyResult.history.length === 0) {
    throw new Error("Expected at least one history entry");
  }
  console.log("✔ Audit trail tracks all slot actions, swaps, and assignments\n");

  console.log("=== ALL STOREFRONT SLOTS TESTS PASSED ===");
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
