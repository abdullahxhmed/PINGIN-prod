import { prisma } from "../lib/prisma.js";

async function main() {
  const tagSkus = ["TAG-KEYCHAIN", "TAG-MINI-STICKER", "TAG-VEHICLE-STICKER", "TAG-PREPRINTED-STD"];

  console.log("=== CHECKING USAGE OF TAG-* SKUs ===");

  // 1. Check ProductComponents
  const components = await prisma.productComponent.findMany({
    where: { inventorySku: { in: tagSkus } },
    include: {
      variant: {
        include: { product: true },
      },
    },
  });
  console.log(`\n1. ProductComponents using TAG-* (${components.length}):`);
  for (const c of components) {
    console.log(`   - Comp "${c.name}" (Variant: ${c.variant.name} [${c.variant.sku}], Product: ${c.variant.product.name} [${c.variant.product.sku}]) -> ${c.inventorySku}`);
  }

  // 2. Check Storefront Slots
  const slots = await prisma.storefrontSlot.findMany({
    include: { product: true, variant: true },
  });
  console.log(`\n2. Storefront Slots (${slots.length}):`);
  for (const s of slots) {
    console.log(`   - Slot ${s.slotKey} (Type: ${s.slotType}): Product [${s.product?.sku}] ${s.product?.name}, Variant [${s.variant?.sku}] ${s.variant?.name}`);
  }

  // 3. Check PrintBatches
  const batches = await prisma.printBatch.findMany({
    where: { sku: { in: tagSkus } },
    select: { id: true, batchNumber: true, sku: true, status: true },
  });
  console.log(`\n3. PrintBatches using TAG-* (${batches.length}):`);
  for (const b of batches) {
    console.log(`   - Batch ${b.batchNumber} (SKU: ${b.sku}, Status: ${b.status})`);
  }

  // 4. Check QrTagInventory & Assigned QrTags
  const inventoryCounts = await prisma.qrTagInventory.groupBy({
    by: ["sku", "state"],
    where: { sku: { in: tagSkus } },
    _count: { id: true },
  });
  console.log(`\n4. QrTagInventory for TAG-*:`);
  console.log(inventoryCounts);

  // Check if any of these are assigned to real users (QrAssignment)
  const assigned = await prisma.qrAssignment.findMany({
    where: {
      qrTag: {
        inventory: {
          sku: { in: tagSkus },
        },
      },
    },
    include: {
      qrTag: true,
      resource: true,
    },
  });
  console.log(`\n5. User-Assigned QrTags linked to TAG-* (${assigned.length}):`);
  for (const a of assigned) {
    console.log(`   - Assigned Tag: ${a.qrTag.tagNumber} to Resource "${a.resource.name}"`);
  }

  // 6. Check Products with PK-* SKUs (the old mock products)
  const oldProducts = await prisma.product.findMany({
    where: {
      sku: { startsWith: "PK-" },
    },
    include: {
      variants: true,
    },
  });
  console.log(`\n6. Old Products with PK-* (${oldProducts.length}):`);
  for (const p of oldProducts) {
    console.log(`   - [${p.sku}] "${p.name}"`);
  }
}

main().finally(async () => {
  await prisma.$disconnect();
});
