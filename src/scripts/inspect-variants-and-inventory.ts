import dotenv from "dotenv";
dotenv.config();

import { prisma } from "../lib/prisma.js";

async function main() {
  const products = await prisma.product.findMany({
    include: {
      variants: {
        include: {
          components: true,
        },
      },
    },
  });

  console.log("=== CURRENT PRODUCTS & VARIANTS ===");
  for (const p of products) {
    console.log(`\nProduct: [${p.sku}] ${p.name} (type: ${p.type})`);
    console.log(`  imageUrl: ${p.imageUrl}`);
    console.log(`  Variants (${p.variants.length}):`);
    for (const v of p.variants) {
      console.log(`    - Variant [${v.sku}] ${v.name} (₹${v.price / 100})`);
      for (const c of v.components) {
        console.log(`        Component [${c.componentType}] ${c.name} x${c.quantity} (inventorySku: ${c.inventorySku})`);
      }
    }
  }

  const inventoryStock = await prisma.inventoryStock.findMany();
  console.log("\n=== INVENTORY STOCK (PHYSICAL ITEMS) ===");
  for (const item of inventoryStock) {
    console.log(`  - [${item.sku}] ${item.name}: onHand=${item.quantityOnHand}, reserved=${item.reservedCount}`);
  }

  const tagCounts = await prisma.qrTagInventory.groupBy({
    by: ["sku", "state"],
    _count: { id: true },
  });
  console.log("\n=== QR TAG INVENTORY (SERIALIZED TAGS) ===");
  for (const tc of tagCounts) {
    console.log(`  - SKU: ${tc.sku} | state: ${tc.state} | count: ${tc._count.id}`);
  }

  const printProfiles = await prisma.printProfile.findMany();
  console.log("\n=== PRINT PROFILES ===");
  for (const pp of printProfiles) {
    console.log(`  - [${pp.sku}] ${pp.name}`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
