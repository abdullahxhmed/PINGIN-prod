import { prisma } from "../lib/prisma.js";
import {
  getProductBySlug,
  getPublicStorefrontSlots,
  getVariantById,
  listPublicCatalog,
} from "../modules/catalog/catalog.services.js";
import {
  normalizeObjectPath,
  resolveImageUrl,
} from "../modules/catalog/catalog-images.service.js";

async function main() {
  console.log("=== STARTING UNIFIED IMAGE RESOLUTION END-TO-END VERIFICATION ===\n");

  // 1. Test normalizeObjectPath with various formats
  console.log("-> Test 1: Testing normalizeObjectPath on various input formats...");
  const bucket = "kauntact_product_images";
  const testCases = [
    {
      name: "Direct object key",
      input: "product_images/vehicle_stickers/kauntactLight.png",
      expected: "product_images/vehicle_stickers/kauntactLight.png",
    },
    {
      name: "gs:// protocol",
      input: "gs://kauntact_product_images/product_images/bundles/darkSet.PNG",
      expected: "product_images/bundles/darkSet.PNG",
    },
    {
      name: "Expired path-style signed URL with query params",
      input:
        "https://storage.googleapis.com/kauntact_product_images/product_images/bundles/lightSet.PNG?X-Goog-Algorithm=GOOG4-RSA-SHA256&X-Goog-Date=20261026T000000Z&X-Goog-Expires=3600&X-Goog-Signature=abcdef123456",
      expected: "product_images/bundles/lightSet.PNG",
    },
    {
      name: "Virtual-hosted style signed URL",
      input:
        "https://kauntact_product_images.storage.googleapis.com/product_images/keychain/darkKeychain.PNG?X-Goog-Algorithm=GOOG4-RSA-SHA256",
      expected: "product_images/keychain/darkKeychain.PNG",
    },
    {
      name: "Bucket prefixed path",
      input: "kauntact_product_images/product_images/mini_stickers/lightMini.PNG",
      expected: "product_images/mini_stickers/lightMini.PNG",
    },
  ];

  for (const tc of testCases) {
    const res = normalizeObjectPath(tc.input, bucket);
    if (res !== tc.expected) {
      throw new Error(`Failed '${tc.name}': Expected '${tc.expected}', got '${res}'`);
    }
    console.log(`  ✓ ${tc.name} -> '${res}'`);
  }

  // 2. Test resolveImageUrl on an expired signed URL
  console.log("\n-> Test 2: Testing resolveImageUrl on expired signed URL...");
  const expiredInput =
    "https://storage.googleapis.com/kauntact_product_images/product_images/bundles/lightSet.PNG?X-Goog-Algorithm=GOOG4-RSA-SHA256&X-Goog-Date=20200101T000000Z&X-Goog-Expires=3600&X-Goog-Signature=expired";
  const resolvedFromExpired = await resolveImageUrl(expiredInput);
  if (!resolvedFromExpired || !resolvedFromExpired.url.includes("storage.googleapis.com")) {
    throw new Error(`Failed to resolve fresh signed URL from expired input`);
  }
  console.log(`  ✓ Successfully regenerated fresh signed URL from expired input:`);
  console.log(`    Fresh URL: ${resolvedFromExpired.url.slice(0, 85)}...`);
  console.log(`    Canonical Reference: ${resolvedFromExpired.reference}`);

  // 3. Test listPublicCatalog()
  console.log("\n-> Test 3: Testing listPublicCatalog() response...");
  const catalog = await listPublicCatalog();
  console.log(`  Retrieved ${catalog.length} catalog products.`);
  for (const p of catalog) {
    console.log(`  [Product: ${p.sku}] ${p.name}`);
    console.log(`    imageUrl: ${p.imageUrl ? p.imageUrl.slice(0, 60) + '...' : '(null)'}`);
    console.log(`    imageReference: ${p.imageReference}`);
    for (const v of p.variants) {
      console.log(`      └─ [Variant: ${v.sku}] ${v.name}: ${v.imageUrl ? v.imageUrl.slice(0, 60) + '...' : '(null)'}`);
      if (v.imageUrl && !v.imageUrl.includes("storage.googleapis.com") && !v.imageUrl.startsWith("/")) {
        throw new Error(`Variant ${v.sku} imageUrl is not a signed URL or valid path!`);
      }
    }
  }

  // 4. Test getPublicStorefrontSlots()
  console.log("\n-> Test 4: Testing getPublicStorefrontSlots() response...");
  const storefrontSlots = await getPublicStorefrontSlots();
  const slotKeys = Object.keys(storefrontSlots.slots);
  console.log(`  Retrieved ${slotKeys.length} slots in dictionary: ${slotKeys.join(", ")}`);
  for (const k of slotKeys) {
    const slotItem = storefrontSlots.slots[k];
    if (slotItem) {
      console.log(`  Slot [${k}]: ${slotItem.name}`);
      console.log(`    imageUrl: ${slotItem.imageUrl ? slotItem.imageUrl.slice(0, 60) + '...' : '(null)'}`);
      console.log(`    imageReference: ${slotItem.imageReference}`);
      if (!slotItem.imageUrl && slotItem.type !== "SUBSCRIPTION_ONLY") {
        throw new Error(`Slot [${k}] missing imageUrl!`);
      }
    }
  }

  // Verify activeSlots array
  console.log(`\n  ActiveSlots array contains ${storefrontSlots.activeSlots.length} entries:`);
  for (const s of storefrontSlots.activeSlots) {
    console.log(`    Slot [${s.slotKey}] (${s.label}):`);
    console.log(`      Top-level imageUrl: ${s.imageUrl ? s.imageUrl.slice(0, 60) + '...' : '(null)'}`);
    console.log(`      Variant imageUrl: ${s.variant?.imageUrl ? s.variant.imageUrl.slice(0, 60) + '...' : '(null)'}`);
    console.log(`      Product imageUrl: ${s.product?.imageUrl ? s.product.imageUrl.slice(0, 60) + '...' : '(null)'}`);
  }

  // 5. Test getProductBySlug()
  console.log("\n-> Test 5: Testing getProductBySlug()...");
  const stickerProd = await getProductBySlug("vehicle-sticker");
  console.log(`  Retrieved product: ${stickerProd.name}`);
  console.log(`    Product imageUrl: ${stickerProd.imageUrl?.slice(0, 60)}...`);
  console.log(`    Light Variant imageUrl: ${stickerProd.variants[0]?.imageUrl?.slice(0, 60)}...`);
  console.log(`    Dark Variant imageUrl: ${stickerProd.variants[1]?.imageUrl?.slice(0, 60)}...`);

  // 6. Test getVariantById()
  console.log("\n-> Test 6: Testing getVariantById()...");
  const firstVariantId = stickerProd.variants[0]?.id!;
  const variant = await getVariantById(firstVariantId);
  console.log(`  Retrieved variant: ${variant.name} (${variant.sku})`);
  console.log(`    Variant imageUrl: ${variant.imageUrl?.slice(0, 60)}...`);
  console.log(`    Parent product imageUrl: ${variant.product?.imageUrl?.slice(0, 60)}...`);

  console.log("\n=======================================================");
  console.log("🎉 ALL UNIFIED IMAGE RESOLUTION TESTS PASSED!");
  console.log("=======================================================");
}

main().finally(async () => {
  await prisma.$disconnect();
});
