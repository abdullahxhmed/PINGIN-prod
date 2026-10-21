import "dotenv/config";
import { prisma } from "../lib/prisma.js";
import {
  encryptPhoneNumber,
  decryptPhoneNumber,
  generatePhoneLookup,
  normalizePhoneNumber,
} from "../utils/phone-encryption.js";

interface ContactEndpointRaw {
  id: string;
  phoneNumber: string;
  phoneEncrypted: string | null;
  phoneLookup: string | null;
}

async function main() {
  console.log("=== Starting ContactEndpoint Phone Fields Backfill ===");

  // Read raw database rows (bypasses Prisma non-null client validation on existing null rows)
  const rows = await prisma.$queryRaw<ContactEndpointRaw[]>`
    SELECT id, "phoneNumber", "phoneEncrypted", "phoneLookup"
    FROM "ContactEndpoint";
  `;

  console.log(`Total ContactEndpoint records in database: ${rows.length}`);

  const endpointsToBackfill = rows.filter(
    (r) => !r.phoneEncrypted || !r.phoneLookup
  );

  console.log(`Found ${endpointsToBackfill.length} records requiring backfill.`);

  if (endpointsToBackfill.length === 0) {
    console.log("All records already have phoneEncrypted and phoneLookup. Nothing to do.");
    return;
  }

  // Pre-validate uniqueness of phoneLookup across the dataset
  const lookupSet = new Set<string>();
  const plan: Array<{
    id: string;
    phoneNumber: string;
    normalized: string;
    encrypted: string;
    lookup: string;
  }> = [];

  for (const ep of endpointsToBackfill) {
    if (!ep.phoneNumber) {
      throw new Error(`Endpoint ${ep.id} has no phoneNumber to backfill from!`);
    }

    const normalized = normalizePhoneNumber(ep.phoneNumber);
    const encrypted = encryptPhoneNumber(ep.phoneNumber);
    const lookup = generatePhoneLookup(ep.phoneNumber);

    // Verify round-trip decryption
    const decrypted = decryptPhoneNumber(encrypted);
    if (decrypted !== normalized) {
      throw new Error(
        `Decryption round-trip check failed for endpoint ${ep.id}! Expected "${normalized}", got "${decrypted}"`
      );
    }

    if (lookupSet.has(lookup)) {
      throw new Error(
        `Duplicate phoneLookup detected for endpoint ${ep.id} (phone: ${ep.phoneNumber})! Unique constraint will fail.`
      );
    }
    lookupSet.add(lookup);

    plan.push({
      id: ep.id,
      phoneNumber: ep.phoneNumber,
      normalized,
      encrypted,
      lookup,
    });
  }

  console.log(`Pre-validation passed for all ${plan.length} records:`);
  for (const item of plan) {
    console.log(`  - [${item.id}] ${item.phoneNumber} -> normalized: ${item.normalized}, lookup: ${item.lookup.slice(0, 16)}...`);
  }

  console.log("Applying updates to database in a single transaction...");
  await prisma.$transaction(async (tx) => {
    for (const item of plan) {
      await tx.$executeRaw`
        UPDATE "ContactEndpoint"
        SET "phoneEncrypted" = ${item.encrypted},
            "phoneLookup" = ${item.lookup},
            "updatedAt" = NOW()
        WHERE id = ${item.id}::uuid;
      `;
    }
  });

  console.log(`Successfully updated ${plan.length} records!`);

  // Verify via raw SQL
  const remainingUnbackfilled = await prisma.$queryRaw<ContactEndpointRaw[]>`
    SELECT id, "phoneNumber", "phoneEncrypted", "phoneLookup"
    FROM "ContactEndpoint"
    WHERE "phoneEncrypted" IS NULL OR "phoneLookup" IS NULL;
  `;

  console.log(`Remaining unbackfilled records: ${remainingUnbackfilled.length}`);
  if (remainingUnbackfilled.length > 0) {
    throw new Error(`Verification failed! ${remainingUnbackfilled.length} records still have null fields.`);
  }

  // Now verify that standard Prisma Client can query all ContactEndpoint records without validation errors
  const prismaRecords = await prisma.contactEndpoint.findMany({
    select: {
      id: true,
      phoneNumber: true,
      phoneEncrypted: true,
      phoneLookup: true,
    },
  });

  console.log(`Prisma Client findMany verified ${prismaRecords.length} records:`);
  for (const record of prismaRecords.slice(0, 3)) {
    console.log(`  ID: ${record.id}`);
    console.log(`    Original Phone: ${record.phoneNumber}`);
    console.log(`    Decrypted:      ${decryptPhoneNumber(record.phoneEncrypted)}`);
    console.log(`    Lookup Hash:    ${record.phoneLookup}`);
  }

  // Test findUnique by phoneLookup
  if (prismaRecords.length > 0 && prismaRecords[0]) {
    const testLookup = prismaRecords[0].phoneLookup;
    const foundByLookup = await prisma.contactEndpoint.findUnique({
      where: { phoneLookup: testLookup },
      select: { id: true, phoneNumber: true },
    });
    console.log(`Tested findUnique({ where: { phoneLookup } }):`, foundByLookup);
  }

  console.log("=== Backfill Complete and Verified! ===");
}

main()
  .catch((err) => {
    console.error("Backfill failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
