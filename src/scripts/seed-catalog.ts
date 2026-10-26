import "dotenv/config";
import { prisma } from "../lib/prisma.js";
import { seedDefaultCatalog } from "../modules/catalog/catalog.services.js";

async function main() {
  console.log("Seeding default ParkPing product catalog & Bill of Materials...");
  await seedDefaultCatalog();
  console.log("Catalog seeded successfully!");
}

main()
  .catch((e) => {
    console.error("Failed to seed catalog:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
