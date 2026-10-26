import dotenv from "dotenv";
dotenv.config();

import { prisma } from "../lib/prisma.js";

async function main() {
  console.log("=== CLEARING ALL INVENTORY (STARTING FRESH) ===\n");

  const [
    stockCount,
    qrTagInvCount,
    batchCount,
    unassignedTagCount,
    assignedTagCount,
  ] = await Promise.all([
    prisma.inventoryStock.count(),
    prisma.qrTagInventory.count(),
    prisma.printBatch.count(),
    prisma.qrTag.count({ where: { status: "UNASSIGNED", resourceId: null } }),
    prisma.qrTag.count({ where: { OR: [{ status: { not: "UNASSIGNED" } }, { resourceId: { not: null } }] } }),
  ]);

  console.log("Current inventory counts:");
  console.log(`  - Physical items (InventoryStock): ${stockCount}`);
  console.log(`  - Serialized tag inventory records (QrTagInventory): ${qrTagInvCount}`);
  console.log(`  - Print batches (PrintBatch): ${batchCount}`);
  console.log(`  - Unassigned inventory QR tags: ${unassignedTagCount}`);
  console.log(`  - Assigned user tags: ${assignedTagCount}`);

  await prisma.$transaction(async (tx) => {
    // 1. Clear any lingering allocations or scans
    await tx.packingScan.deleteMany();
    await tx.packingSession.deleteMany();
    await tx.orderTagAllocation.deleteMany();

    // 2. Clear reservations
    await tx.reservedTag.deleteMany();
    await tx.reservationItem.deleteMany();
    await tx.inventoryReservation.deleteMany();

    // 3. Clear QrTagInventory
    const deletedInv = await tx.qrTagInventory.deleteMany();
    console.log(`✔ Deleted ${deletedInv.count} QrTagInventory records`);

    // 4. Clear PrintBatches
    const deletedBatches = await tx.printBatch.deleteMany();
    console.log(`✔ Deleted ${deletedBatches.count} PrintBatches`);

    // 5. Clear physical InventoryStock
    const deletedStock = await tx.inventoryStock.deleteMany();
    console.log(`✔ Deleted ${deletedStock.count} InventoryStock items`);

    // 6. Delete assignments and visits referencing unassigned inventory QrTags
    await tx.qrAssignment.deleteMany({
      where: {
        qrTag: {
          status: "UNASSIGNED",
          resourceId: null,
        },
      },
    });
    await tx.tagVisit.deleteMany({
      where: {
        qrTag: {
          status: "UNASSIGNED",
          resourceId: null,
        },
      },
    });

    // 7. Delete unassigned inventory QrTags
    const deletedTags = await tx.qrTag.deleteMany({
      where: {
        status: "UNASSIGNED",
        resourceId: null,
      },
    });
    console.log(`✔ Deleted ${deletedTags.count} unassigned inventory QR tags`);
  });

  console.log("\n=== ALL INVENTORY SUCCESSFULLY WIPED CLEAN ===");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
