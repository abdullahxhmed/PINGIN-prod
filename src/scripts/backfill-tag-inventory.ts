import "dotenv/config";
import { prisma } from "../lib/prisma.js";
import { QrTagStatus, QrTagStockState } from "@prisma/client";
import { seedDefaultCatalog } from "../modules/catalog/catalog.services.js";

async function main() {
  console.log("=== 1. Syncing Catalog Components with inventorySku ===");
  await seedDefaultCatalog();

  // Also update existing components if they had null inventorySku
  await prisma.productComponent.updateMany({
    where: {
      componentType: "SERIALIZED_QR_TAG",
      inventorySku: null,
    },
    data: {
      inventorySku: "TAG-PREPRINTED-STD",
    },
  });
  console.log("Catalog components verified!");

  console.log("\n=== 2. Backfilling QrTagInventory ===");
  const tagsWithoutInventory = await prisma.qrTag.findMany({
    where: {
      inventory: null,
    },
    select: {
      id: true,
      tagNumber: true,
      status: true,
    },
  });

  console.log(`Found ${tagsWithoutInventory.length} tags needing inventory records.`);

  for (const tag of tagsWithoutInventory) {
    let state: QrTagStockState = QrTagStockState.IN_STOCK;
    if (tag.status === QrTagStatus.ASSIGNED) {
      state = QrTagStockState.DELIVERED;
    } else if (tag.status === QrTagStatus.REVOKED || tag.status === QrTagStatus.SUSPENDED) {
      state = QrTagStockState.DAMAGED;
    }

    await prisma.qrTagInventory.create({
      data: {
        qrTagId: tag.id,
        sku: "TAG-PREPRINTED-STD",
        state,
      },
    });
  }

  const totalInventory = await prisma.qrTagInventory.count();
  const inStockCount = await prisma.qrTagInventory.count({
    where: { state: QrTagStockState.IN_STOCK },
  });

  console.log(`Successfully backfilled! Total inventory records: ${totalInventory}, IN_STOCK: ${inStockCount}`);
}

main()
  .catch((e) => {
    console.error("Backfill failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
