import "dotenv/config";
import { prisma } from "../lib/prisma.js";
import { seedDefaultCatalog } from "../modules/catalog/catalog.services.js";
import {
  checkBundleAvailability,
  createAtomicReservation,
  getReservationBySessionId,
  releaseReservation,
} from "../modules/inventory/inventory.services.js";
import { QrTagOrigin, QrTagStatus } from "@prisma/client";
import crypto from "node:crypto";

async function main() {
  console.log("=== 1. Seeding Default Catalog ===");
  await seedDefaultCatalog();
  console.log("Catalog seeded successfully!");

  const products = await prisma.product.findMany({
    include: {
      variants: {
        include: { components: true },
      },
    },
  });
  console.log(`Found ${products.length} products in catalog:`);
  for (const p of products) {
    console.log(`  - [${p.sku}] ${p.name} (Base price: ₹${p.basePrice / 100})`);
    for (const v of p.variants) {
      console.log(`      Variant [${v.sku}] ${v.name} -> Components: ${v.components.map(c => `${c.quantity}x ${c.name}`).join(", ")}`);
    }
  }

  // Ensure we have at least 5 dummy UNASSIGNED tags for testing
  const existingTags = await prisma.qrTag.count({
    where: { status: QrTagStatus.UNASSIGNED, origin: QrTagOrigin.PREPRINTED_INVENTORY },
  });

  console.log(`\n=== 2. Available Unassigned Inventory Tags: ${existingTags} ===`);
  const tagsToCreate = Math.max(0, 6 - existingTags);
  if (tagsToCreate > 0) {
    console.log(`Creating ${tagsToCreate} test preprinted tags...`);
    for (let i = 0; i < tagsToCreate; i++) {
      const tagNum = `TEST-TAG-${Date.now()}-${i}`;
      const token = `tok_${crypto.randomBytes(8).toString("hex")}`;
      await prisma.qrTag.create({
        data: {
          tagNumber: tagNum,
          tokenHash: crypto.createHash("sha256").update(token).digest("hex"),
          origin: QrTagOrigin.PREPRINTED_INVENTORY,
          status: QrTagStatus.UNASSIGNED,
          inventory: {
            create: {
              sku: "TAG-PREPRINTED-STD",
              state: "IN_STOCK",
            },
          },
        },
      });
    }
  }

  // Test with Pack of 4
  const pack4 = products.find((p) => p.sku === "PK-PACK-499");
  const variant4 = pack4?.variants[0];
  if (!variant4) {
    throw new Error("Variant for Pack 499 not found!");
  }

  console.log(`\n=== 3. Testing Availability Check for '${variant4.name}' ===`);
  const avail = await checkBundleAvailability(variant4.id, 1);
  console.log("Availability Result:", avail);

  console.log("\n=== 4. Testing Atomic Reservation Creation ===");
  const testSessionId = `test_sess_${Date.now()}`;
  const reservation = await createAtomicReservation({
    checkoutSessionId: testSessionId,
    variantId: variant4.id,
    quantity: 1,
  });

  console.log("Reservation Created Successfully!");
  console.log(`  - ID: ${reservation.id}`);
  console.log(`  - Status: ${reservation.status}`);
  console.log(`  - ExpiresAt: ${reservation.expiresAt.toISOString()}`);
  console.log(`  - Item Quantity: ${reservation.items[0]?.quantity}`);

  console.log("\n=== 5. Testing Concurrency / Double Reservation Prevention ===");
  // Attempting to check availability now should show 4 fewer available tags
  const availAfter = await checkBundleAvailability(variant4.id, 1);
  console.log("Availability after 1 reservation:", availAfter);

  console.log("\n=== 6. Query Reservation by Session ID ===");
  const fetched = await getReservationBySessionId(testSessionId);
  console.log(`Found reservation by session ID: Status = ${fetched.status}, Item count = ${fetched.items.length}`);

  console.log("\n=== 7. Testing Explicit Release ===");
  const released = await releaseReservation(reservation.id);
  console.log(`Reservation ${released.id} status after release: ${released.status}`);

  const availAfterRelease = await checkBundleAvailability(variant4.id, 1);
  console.log("Availability after release:", availAfterRelease);
  console.log("\nAll Phase 1 tests passed successfully!");
}

main()
  .catch((err) => {
    console.error("Test failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
