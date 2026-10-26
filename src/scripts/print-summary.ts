import { prisma } from "../lib/prisma.js";
import { adminGetInventorySummary } from "../modules/admin/inventory/admin.inventory.services.js";

async function main() {
  const summary = await adminGetInventorySummary();
  console.log("=== CURRENT ACTIVE INVENTORY BREAKDOWN ===");
  console.table(summary.serializedBySku);
}

main().finally(async () => {
  await prisma.$disconnect();
});
