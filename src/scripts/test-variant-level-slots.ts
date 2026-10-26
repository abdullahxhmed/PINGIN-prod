import dotenv from "dotenv";
dotenv.config();

import { prisma } from "../lib/prisma.js";
import {
  adminListStorefrontSlots,
  adminUpdateStorefrontSlot,
  seedDefaultStorefrontSlots,
} from "../modules/admin/catalog/admin.storefront-slots.services.js";
import { listPublicCatalog } from "../modules/catalog/catalog.services.js";

async function main() {
  console.log("=== TESTING TRUE VARIANT-LEVEL SLOTS & AUTO-SWAP ===\n");

  await seedDefaultStorefrontSlots();

  // 1. Fetch products & variants
  const product = await prisma.product.findFirst({
    where: { active: true },
    include: { variants: { where: { active: true } } },
  });

  if (!product || product.variants.length === 0) {
    throw new Error("Expected at least one active product with a variant to test variant-level slots");
  }

  const variant = product.variants[0]!;
  console.log(`[Test 1] Using test product: '${product.name}' (${product.id})`);
  console.log(`         Using test variant: '${variant.name}' (${variant.id}) - ₹${variant.price / 100}\n`);

  // 2. Assign variant directly to individual_1
  console.log("[Test 2] Assigning variant directly to 'individual_1'...");
  const updatedSlot = await adminUpdateStorefrontSlot("individual_1", {
    variantId: variant.id,
    reason: "Binding slot directly to variant",
    changedBy: "test-runner",
  });

  console.log(`Updated Slot: [${updatedSlot.slotKey}] ${updatedSlot.label}`);
  console.log(`  - Bound productId: ${updatedSlot.productId}`);
  console.log(`  - Bound variantId: ${updatedSlot.variantId}`);
  console.log(`  - Variant Name:    ${updatedSlot.variant?.name}`);
  console.log(`  - Variant SKU:     ${updatedSlot.variant?.sku}`);

  if (updatedSlot.variantId !== variant.id || updatedSlot.productId !== product.id) {
    throw new Error("Variant-level slot assignment failed!");
  }
  console.log("✔ Variant-level assignment succeeded\n");

  // 3. Test Public Catalog Rendering
  console.log("[Test 3] Testing public catalog resolution of variant-level slot...");
  const publicCatalog = await listPublicCatalog();
  const slottedCard = (publicCatalog as any).slots?.individual_1;

  if (!slottedCard) {
    throw new Error("Expected 'individual_1' in public catalog slots");
  }

  console.log(`Public Catalog Slot [individual_1]:`);
  console.log(`  - Name:               ${slottedCard.name}`);
  console.log(`  - Selected VariantId: ${slottedCard.selectedVariantId}`);
  console.log(`  - Variant Name:       ${slottedCard.variantName}`);
  console.log(`  - Base Price:         ₹${slottedCard.basePrice / 100}`);
  console.log(`  - Card Image URL:     ${slottedCard.imageUrl?.slice(0, 60)}...`);

  if (slottedCard.selectedVariantId !== variant.id) {
    throw new Error("Public catalog did not bind selectedVariantId to the slotted variant!");
  }
  console.log("✔ Public catalog accurately renders variant-level card\n");

  // 4. Test Auto-Swap: Move same variant to individual_2
  console.log("[Test 4] Testing Auto-Swap when moving variant to 'individual_2'...");
  await adminUpdateStorefrontSlot("individual_2", {
    variantId: variant.id,
    reason: "Testing auto-swap of variant",
    changedBy: "test-runner",
  });

  const slotsAfterSwap = await adminListStorefrontSlots();
  const slot1 = slotsAfterSwap.slots.find((s) => s.slotKey === "individual_1");
  const slot2 = slotsAfterSwap.slots.find((s) => s.slotKey === "individual_2");

  console.log(`After swap:`);
  console.log(`  - individual_1: variantId=${slot1?.variantId ?? "null"}`);
  console.log(`  - individual_2: variantId=${slot2?.variantId ?? "null"} (${slot2?.variant?.name})`);

  if (slot2?.variantId !== variant.id || slot1?.variantId === variant.id) {
    throw new Error("Auto-swap of variant failed!");
  }
  console.log("✔ Auto-swap of variant verified successfully\n");

  // 5. Clean up: Clear slot
  console.log("[Test 5] Clearing test slot...");
  await adminUpdateStorefrontSlot("individual_2", {
    productId: null,
    variantId: null,
    reason: "Cleanup test",
  });
  console.log("✔ Cleanup complete\n");

  console.log("=== ALL TRUE VARIANT-LEVEL SLOT TESTS PASSED ===");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
