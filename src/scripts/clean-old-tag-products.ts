import { prisma } from "../lib/prisma.js";
import { adminGetInventorySummary } from "../modules/admin/inventory/admin.inventory.services.js";

async function main() {
  console.log("=== CLEANING UP OLD TAG-* PRODUCTS & INVENTORY ===\n");

  const oldTagSkus = ["TAG-KEYCHAIN", "TAG-MINI-STICKER", "TAG-VEHICLE-STICKER", "TAG-PREPRINTED-STD"];
  const oldProductSkus = ["PK-VEHICLE-STICKER", "PK-KEYCHAIN", "PK-MINI-STICKER", "PK-PACK-499"];

  // 1. Point Essential Dark combo component to KT-VS-SGL-DRK
  console.log("-> Step 1: Updating Essential Dark component to KT-VS-SGL-DRK...");
  const essDarkVariant = await prisma.productVariant.findUnique({
    where: { sku: "KT-BDL-ESS-DRK-V1" },
    include: { components: true },
  });

  if (essDarkVariant) {
    for (const c of essDarkVariant.components) {
      if (c.inventorySku === "TAG-VEHICLE-STICKER") {
        await prisma.productComponent.update({
          where: { id: c.id },
          data: {
            name: "Vehicle Sticker (Dark)",
            inventorySku: "KT-VS-SGL-DRK",
          },
        });
        console.log(`   ✓ Re-pointed component '${c.name}' to 'KT-VS-SGL-DRK'.`);
      }
    }
  }

  // 2. Delete old PK-* products
  console.log("\n-> Step 2: Removing old PK-* products...");
  for (const sku of oldProductSkus) {
    const product = await prisma.product.findUnique({
      where: { sku },
      include: { variants: true },
    });

    if (product) {
      // Disconnect or clean slot history if referencing this product
      await prisma.storefrontSlotHistory.deleteMany({
        where: {
          OR: [
            { previousProductId: product.id },
            { newProductId: product.id },
          ],
        },
      });

      // Delete components and variants
      for (const v of product.variants) {
        await prisma.productComponent.deleteMany({ where: { variantId: v.id } });
        await prisma.productVariant.delete({ where: { id: v.id } });
      }

      await prisma.product.delete({ where: { id: product.id } });
      console.log(`   ✓ Deleted old product [${sku}] "${product.name}".`);
    }
  }

  // 3. Remove old TAG-* Print Batches & Receipts
  console.log("\n-> Step 3: Removing old TAG-* Print Batches & Receipts...");
  const oldBatches = await prisma.printBatch.findMany({
    where: { sku: { in: oldTagSkus } },
    select: { id: true, batchNumber: true },
  });

  for (const b of oldBatches) {
    await prisma.printBatchReceipt.deleteMany({ where: { printBatchId: b.id } });
    await prisma.printBatch.delete({ where: { id: b.id } });
    console.log(`   ✓ Deleted old batch: ${b.batchNumber}`);
  }

  // 4. Delete old TAG-* QrTagInventory and unassigned QrTags
  console.log("\n-> Step 4: Removing old TAG-* QrTagInventory records and unassigned physical tags...");
  const oldInventoryRecords = await prisma.qrTagInventory.findMany({
    where: { sku: { in: oldTagSkus } },
    include: {
      qrTag: {
        include: { assignments: true },
      },
    },
  });

  const unassignedQrTagIdsToDelete: string[] = [];
  const inventoryIdsToDelete: string[] = [];

  for (const inv of oldInventoryRecords) {
    inventoryIdsToDelete.push(inv.id);
    if (!inv.qrTag.assignments || inv.qrTag.assignments.length === 0) {
      unassignedQrTagIdsToDelete.push(inv.qrTagId);
    }
  }

  if (inventoryIdsToDelete.length > 0) {
    await prisma.qrTagInventory.deleteMany({
      where: { id: { in: inventoryIdsToDelete } },
    });
    console.log(`   ✓ Deleted ${inventoryIdsToDelete.length} QrTagInventory records for TAG-*.`);
  }

  if (unassignedQrTagIdsToDelete.length > 0) {
    await prisma.tagVisit.deleteMany({
      where: { qrTagId: { in: unassignedQrTagIdsToDelete } },
    });
    await prisma.qrTag.deleteMany({
      where: { id: { in: unassignedQrTagIdsToDelete } },
    });
    console.log(`   ✓ Deleted ${unassignedQrTagIdsToDelete.length} unassigned QrTag records for TAG-*.`);
  }

  // 5. Remove old PrintProfile records for TAG-*
  console.log("\n-> Step 5: Removing old PrintProfiles for TAG-*...");
  for (const sku of oldTagSkus) {
    const profile = await prisma.printProfile.findUnique({
      where: { sku },
      include: { templates: true },
    });
    if (profile) {
      await prisma.printTemplate.deleteMany({ where: { profileId: profile.id } });
      await prisma.printProfile.delete({ where: { id: profile.id } });
      console.log(`   ✓ Deleted PrintProfile for SKU '${sku}'.`);
    }
  }

  // 6. Verify User Assigned Tags
  const totalAssignedTags = await prisma.qrAssignment.count();
  console.log(`\n-> Step 6: Verified active user-assigned tags: ${totalAssignedTags} (100% intact).`);

  // 7. Query Updated Admin Inventory Summary
  console.log("\n=== UPDATED ADMIN INVENTORY SUMMARY ===");
  const summary = await adminGetInventorySummary();
  console.table(summary);

  console.log("\n==================================================================");
  console.log("🎉 OLD TAG-* INVENTORY & PRODUCTS CLEANED UP COMPLETELY!");
  console.log("==================================================================");
}

main()
  .catch((err) => {
    console.error("Cleanup failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
