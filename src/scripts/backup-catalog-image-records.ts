import fs from "fs";
import path from "path";
import { prisma } from "../lib/prisma.js";

async function main() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = path.resolve(process.cwd(), "backups");
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const [products, variants, slots] = await Promise.all([
    prisma.product.findMany(),
    prisma.productVariant.findMany(),
    prisma.storefrontSlot.findMany(),
  ]);

  const backupData = {
    timestamp,
    counts: {
      products: products.length,
      variants: variants.length,
      slots: slots.length,
    },
    products,
    variants,
    slots,
  };

  const backupPath = path.join(backupDir, `catalog_images_backup_${timestamp}.json`);
  fs.writeFileSync(backupPath, JSON.stringify(backupData, null, 2), "utf8");

  console.log(`✓ Backup successfully created at: ${backupPath}`);
  console.log(`  Products: ${products.length}, Variants: ${variants.length}, Slots: ${slots.length}`);
}

main().finally(async () => {
  await prisma.$disconnect();
});
