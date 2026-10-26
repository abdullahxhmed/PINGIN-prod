import { prisma } from "../lib/prisma.js";
import { adminListStorefrontSlots } from "../modules/admin/catalog/admin.storefront-slots.services.js";

async function main() {
  const result = await adminListStorefrontSlots();
  console.log("=== CURRENT STOREFRONT SLOTS ===");
  for (const s of result.slots) {
    console.log(`Slot [${s.slotKey}] (${s.slotType}): Label="${s.label}"`);
    console.log(`  Product: ${s.product ? `[${s.product.sku}] ${s.product.name} (type: ${s.product.type})` : 'EMPTY'}`);
    console.log(`  Variant: ${s.variant ? `[${s.variant.sku}] ${s.variant.name}` : 'Default (null)'}`);
  }
}

main().finally(async () => {
  await prisma.$disconnect();
});
