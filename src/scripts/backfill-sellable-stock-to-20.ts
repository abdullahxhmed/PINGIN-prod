import { ComponentType, QrTagOrigin, QrTagStatus, QrTagStockState } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { generateOpaqueToken, generateTagNumber, hashQrToken } from "../modules/qr/qr.services.js";
import { listPublicCatalog } from "../modules/catalog/catalog.services.js";

async function main() {
  console.log("=== BACKFILLING SELLABLE STOCK TO AT LEAST 20 UNITS PER PRODUCT ===\n");

  // 1. Gather all active products, variants, and components
  const products = await prisma.product.findMany({
    where: { active: true },
    include: {
      variants: {
        where: { active: true },
        include: { components: true },
      },
    },
  });

  // Calculate required physical units per inventorySku so every variant gets >= 20 availableQuantity
  const targetUnitsPerVariant = 20;
  const skuRequiredMap = new Map<string, number>();

  for (const product of products) {
    for (const variant of product.variants) {
      for (const comp of variant.components) {
        if (comp.componentType === ComponentType.SERIALIZED_QR_TAG && comp.inventorySku) {
          const neededForThisVariant = targetUnitsPerVariant * comp.quantity;
          const currentMax = skuRequiredMap.get(comp.inventorySku) || 0;
          if (neededForThisVariant > currentMax) {
            skuRequiredMap.set(comp.inventorySku, neededForThisVariant);
          }
        } else if (comp.componentType === ComponentType.PHYSICAL_ITEM && comp.inventorySku) {
          const neededForThisVariant = targetUnitsPerVariant * comp.quantity;
          const currentMax = skuRequiredMap.get(comp.inventorySku) || 0;
          if (neededForThisVariant > currentMax) {
            skuRequiredMap.set(comp.inventorySku, neededForThisVariant);
          }
        }
      }
    }
  }

  // Ensure minimum buffer of 50 tags per SKU so all singles and combos have plenty of headroom
  for (const [sku, needed] of skuRequiredMap.entries()) {
    skuRequiredMap.set(sku, Math.max(needed, 50));
  }

  console.log("Target physical inventory per SKU to guarantee >= 20 sellable units across all variants:");
  for (const [sku, needed] of skuRequiredMap.entries()) {
    console.log(`  - SKU: ${sku.padEnd(25)} -> Target In-Stock: ${needed}`);
  }
  console.log();

  // 2. Check current in-stock counts and create missing tags
  for (const [sku, targetCount] of skuRequiredMap.entries()) {
    const currentInStock = await prisma.qrTagInventory.count({
      where: {
        sku,
        state: QrTagStockState.IN_STOCK,
        activeReservationId: null,
      },
    });

    const deficit = targetCount - currentInStock;
    if (deficit <= 0) {
      console.log(`✓ SKU '${sku}' already has ${currentInStock} in stock (target: ${targetCount}). No backfill needed.`);
      continue;
    }

    console.log(`-> Backfilling ${deficit} tags for SKU '${sku}' (Current: ${currentInStock}, Target: ${targetCount})...`);

    // Generate tokens and items
    const items: Array<{ tagNumber: string; token: string; tokenHash: string }> = [];
    const usedTagNumbers = new Set<string>();

    for (let i = 0; i < deficit; i++) {
      let tagNumber = generateTagNumber();
      while (usedTagNumbers.has(tagNumber)) {
        tagNumber = generateTagNumber();
      }
      usedTagNumbers.add(tagNumber);
      const token = generateOpaqueToken();
      items.push({
        tagNumber,
        token,
        tokenHash: hashQrToken(token),
      });
    }

    // Atomically insert QrTag and QrTagInventory in IN_STOCK state
    await prisma.$transaction(async (tx) => {
      await tx.qrTag.createMany({
        data: items.map((item) => ({
          tagNumber: item.tagNumber,
          tokenHash: item.tokenHash,
          origin: QrTagOrigin.PREPRINTED_INVENTORY,
          status: QrTagStatus.UNASSIGNED,
        })),
        skipDuplicates: true,
      });

      const createdTags = await tx.qrTag.findMany({
        where: { tagNumber: { in: items.map((i) => i.tagNumber) } },
        select: { id: true },
      });

      await tx.qrTagInventory.createMany({
        data: createdTags.map((t) => ({
          qrTagId: t.id,
          sku,
          state: QrTagStockState.IN_STOCK,
        })),
        skipDuplicates: true,
      });
    });

    const updatedStock = await prisma.qrTagInventory.count({
      where: { sku, state: QrTagStockState.IN_STOCK, activeReservationId: null },
    });
    console.log(`   ✓ Successfully added ${deficit} tags. Total in stock for '${sku}': ${updatedStock}`);
  }

  // 3. Verify Public Catalog API output
  console.log("\n=== VERIFYING PUBLIC CATALOG API FOR ALL PRODUCTS ===");
  const catalog = await listPublicCatalog();

  let allProductsPassed = true;
  for (const p of catalog) {
    console.log(`\n📦 Product: [${p.sku}] "${p.name}" (InStock: ${p.inStock})`);
    for (const v of p.variants) {
      const isPassed = v.inStock && v.availableQuantity >= targetUnitsPerVariant;
      if (!isPassed) allProductsPassed = false;
      const statusIcon = isPassed ? "✅" : "❌";
      console.log(`   ${statusIcon} Variant: [${v.sku}] "${v.name}" -> Available: ${v.availableQuantity} units (InStock: ${v.inStock})`);
      for (const c of v.components) {
        if (c.inventorySku) {
          console.log(`        └─ Component "${c.name}" [${c.inventorySku}] Qty/pack: ${c.quantity} | Available Stock: ${c.availableStock} | Max Units: ${c.maxUnits}`);
        }
      }
    }
  }

  console.log("\n==================================================================");
  if (allProductsPassed) {
    console.log("🎉 SUCCESS: Every active product and variant now has >= 20 sellable units in stock!");
  } else {
    console.log("⚠️ Some variants did not reach the target.");
  }
  console.log("==================================================================");
}

main()
  .catch((err) => {
    console.error("Backfill failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
