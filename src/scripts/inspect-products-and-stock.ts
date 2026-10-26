import { prisma } from "../lib/prisma.js";
import { listPublicCatalog } from "../modules/catalog/catalog.services.js";

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

  console.log("=== DB PRODUCTS & VARIANTS ===");
  for (const p of products) {
    console.log(`Product [${p.sku}] "${p.name}" (Type: ${p.type}, Active: ${p.active})`);
    for (const v of p.variants) {
      console.log(`  └─ Variant [${v.sku}] "${v.name}" (Price: ${v.price / 100} INR)`);
      for (const c of v.components) {
        console.log(`       └─ Comp: "${c.name}" | Type: ${c.componentType} | Qty: ${c.quantity} | Sku: ${c.inventorySku || 'NONE'}`);
      }
    }
  }

  console.log("\n=== PUBLIC CATALOG AVAILABILITY API RESULT ===");
  const catalog = await listPublicCatalog();
  for (const p of catalog) {
    console.log(`Catalog Product [${p.sku}] "${p.name}" InStock: ${p.inStock}`);
    for (const v of p.variants) {
      console.log(`  └─ Variant [${v.sku}] "${v.name}" InStock: ${v.inStock}, AvailableQty: ${v.availableQuantity}`);
      for (const c of v.components) {
        console.log(`       └─ Comp "${c.name}" (${c.inventorySku}): AvailableStock: ${c.availableStock}, MaxUnits: ${c.maxUnits}`);
      }
    }
  }
}

main().finally(async () => {
  await prisma.$disconnect();
});
