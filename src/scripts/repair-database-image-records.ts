import { Storage } from "@google-cloud/storage";
import { prisma } from "../lib/prisma.js";

const storage = new Storage({
  ...(process.env.GCS_PROJECT_ID ? { projectId: process.env.GCS_PROJECT_ID } : {}),
  ...(process.env.GCS_CLIENT_EMAIL && process.env.GCS_PRIVATE_KEY
    ? {
        credentials: {
          client_email: process.env.GCS_CLIENT_EMAIL,
          private_key: process.env.GCS_PRIVATE_KEY.replace(/\\n/g, "\n"),
        },
      }
    : {}),
  ...(process.env.GOOGLE_APPLICATION_CREDENTIALS
    ? { keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS }
    : {}),
});

const bucketName = process.env.GCS_BUCKET_NAME || "kauntact_product_images";

function extractGcsKey(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // If already clean relative object key
  if (trimmed.startsWith("product_images/")) {
    return trimmed;
  }

  // Strip query params & hash
  const withoutQuery = (trimmed.split("?")[0] || "").split("#")[0] || "";

  // Match gs:// or https://storage.googleapis.com/<bucket>/<key>
  const match = withoutQuery.match(/^https?:\/\/(?:storage\.googleapis\.com|storage\.cloud\.google\.com)\/([^/]+)\/(.+)$/i);
  if (match && match[2]) {
    const extractedBucket = match[1];
    const key = decodeURIComponent(match[2]);
    if (extractedBucket !== bucketName) {
      console.warn(`Warning: Image references bucket '${extractedBucket}' but expected '${bucketName}': ${trimmed}`);
    }
    return key;
  }

  if (withoutQuery.startsWith(`gs://${bucketName}/`)) {
    return decodeURIComponent(withoutQuery.slice(`gs://${bucketName}/`.length));
  }

  return trimmed;
}

async function verifyObjectExistsInGcs(key: string): Promise<boolean> {
  try {
    const bucket = storage.bucket(bucketName);
    const [exists] = await bucket.file(key).exists();
    return exists;
  } catch (err: any) {
    console.error(`Error verifying GCS key '${key}':`, err.message);
    return false;
  }
}

async function main() {
  console.log(`=== STARTING DATABASE IMAGE RECORDS REPAIR (Target Bucket: ${bucketName}) ===\n`);

  const [products, variants] = await Promise.all([
    prisma.product.findMany({ select: { id: true, sku: true, name: true, imageUrl: true } }),
    prisma.productVariant.findMany({ select: { id: true, sku: true, name: true, imageUrl: true, productId: true } }),
  ]);

  const productMap = new Map(products.map((p) => [p.id, p]));

  // 1. Repair Products
  console.log("-> Step 1: Inspecting & repairing Product.imageUrl records...");
  for (const p of products) {
    if (!p.imageUrl) continue;

    const extracted = extractGcsKey(p.imageUrl);
    if (!extracted) continue;

    if (p.imageUrl !== extracted) {
      console.log(`\nProduct [${p.sku}] "${p.name}":`);
      console.log(`  Current stored: ${p.imageUrl.slice(0, 80)}...`);
      console.log(`  Target clean key: ${extracted}`);

      const exists = await verifyObjectExistsInGcs(extracted);
      if (!exists) {
        throw new Error(`CRITICAL: Object '${extracted}' does NOT exist in bucket '${bucketName}'! Aborting.`);
      }
      console.log(`  ✓ Verified GCS object exists: gs://${bucketName}/${extracted}`);

      await prisma.product.update({
        where: { id: p.id },
        data: { imageUrl: extracted },
      });
      console.log(`  ✓ Updated Product [${p.sku}] imageUrl to '${extracted}'`);
    } else {
      console.log(`  ✓ Product [${p.sku}] already has clean key: '${p.imageUrl}'`);
    }
  }

  // 2. Repair ProductVariants
  console.log("\n-> Step 2: Inspecting & repairing ProductVariant.imageUrl records...");
  for (const v of variants) {
    const parent = productMap.get(v.productId);

    // If variant has signed URL
    if (v.imageUrl && (v.imageUrl.includes("storage.googleapis.com") || v.imageUrl.includes("?X-Goog-"))) {
      const extracted = extractGcsKey(v.imageUrl);
      if (extracted) {
        console.log(`\nVariant [${v.sku}] "${v.name}":`);
        console.log(`  Current stored: ${v.imageUrl.slice(0, 80)}...`);
        console.log(`  Target clean key: ${extracted}`);

        const exists = await verifyObjectExistsInGcs(extracted);
        if (!exists) {
          throw new Error(`CRITICAL: Object '${extracted}' does NOT exist in bucket '${bucketName}'! Aborting.`);
        }
        await prisma.productVariant.update({
          where: { id: v.id },
          data: { imageUrl: extracted },
        });
        console.log(`  ✓ Updated Variant [${v.sku}] imageUrl to '${extracted}'`);
      }
    } else if (!v.imageUrl && parent && parent.imageUrl) {
      // If variant has null imageUrl, backfill with parent's clean imageUrl for consistency
      const parentCleanKey = extractGcsKey(parent.imageUrl);
      if (parentCleanKey && parentCleanKey.startsWith("product_images/")) {
        const exists = await verifyObjectExistsInGcs(parentCleanKey);
        if (exists) {
          await prisma.productVariant.update({
            where: { id: v.id },
            data: { imageUrl: parentCleanKey },
          });
          console.log(`  ✓ Backfilled Variant [${v.sku}] from parent [${parent.sku}] with clean key: '${parentCleanKey}'`);
        }
      }
    } else {
      console.log(`  ✓ Variant [${v.sku}] status: ${v.imageUrl || '(null - digital/none)'}`);
    }
  }

  console.log("\n=======================================================");
  console.log("🎉 DATABASE IMAGE REPAIR COMPLETED SUCCESSFULLY!");
  console.log("=======================================================");
}

main().finally(async () => {
  await prisma.$disconnect();
});
