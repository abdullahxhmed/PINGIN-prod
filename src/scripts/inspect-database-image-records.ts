import { prisma } from "../lib/prisma.js";

async function main() {
  const products = await prisma.product.findMany({
    select: {
      id: true,
      sku: true,
      name: true,
      imageUrl: true,
      variants: {
        select: {
          id: true,
          sku: true,
          name: true,
          imageUrl: true,
        },
      },
    },
  });

  console.log("=== STORED PRODUCT & VARIANT IMAGE URLS ===");
  for (const p of products) {
    console.log(`\n[PRODUCT] ${p.sku} - ${p.name}`);
    console.log(`  imageUrl: ${p.imageUrl}`);
    for (const v of p.variants) {
      console.log(`    [VARIANT] ${v.sku} - ${v.name}: ${v.imageUrl}`);
    }
  }

  // Also check StorefrontSlot
  const slots = await prisma.storefrontSlot.findMany({
    include: {
      product: { select: { sku: true, name: true, imageUrl: true } },
      variant: { select: { sku: true, name: true, imageUrl: true } },
    },
  });
  console.log("\n=== STOREFRONT SLOTS ===");
  for (const s of slots) {
    console.log(`[SLOT] ${s.slotKey} (${s.label})`);
    console.log(`  Product: ${s.product?.sku} (img: ${s.product?.imageUrl})`);
    console.log(`  Variant: ${s.variant?.sku} (img: ${s.variant?.imageUrl})`);
  }
}

main().finally(async () => {
  await prisma.$disconnect();
});
