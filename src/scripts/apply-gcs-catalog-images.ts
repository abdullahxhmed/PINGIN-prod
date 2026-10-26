import { prisma } from "../lib/prisma.js";

interface ProductGcsArtwork {
  sku: string;
  imageUrl: string;
}

const GCS_PRODUCT_IMAGES: ProductGcsArtwork[] = [
  {
    sku: "PK-PACK-179", // Essential
    imageUrl: "product_images/vehicle_stickers/darkDuo.PNG",
  },
  {
    sku: "PK-PACK-499", // Curated Kit
    imageUrl: "product_images/bundles/darkSet.PNG",
  },
  {
    sku: "PK-VEHICLE-STICKER", // Vehicle QR Sticker
    imageUrl: "product_images/vehicle_stickers/kauntactDark.png",
  },
  {
    sku: "PK-KEYCHAIN", // Smart QR Keychain
    imageUrl: "product_images/keychain/darkKeychain.PNG",
  },
  {
    sku: "PK-MINI-STICKER", // Mini QR Sticker
    imageUrl: "product_images/mini_stickers/darkMini.PNG",
  },
  {
    sku: "PK-PLUS-RENEWAL", // 12-Month Plus Plan Renewal
    imageUrl: "product_images/vehicle_stickers/darkDuo.PNG",
  },
];

async function applyGcsCatalogImages() {
  console.log("Applying exact-cased GCS bucket artwork to catalog products...");

  for (const item of GCS_PRODUCT_IMAGES) {
    const product = await prisma.product.findUnique({
      where: { sku: item.sku },
    });

    if (!product) {
      console.warn(`Product with SKU '${item.sku}' not found, skipping.`);
      continue;
    }

    await prisma.product.update({
      where: { id: product.id },
      data: {
        imageUrl: item.imageUrl,
      },
    });

    console.log(`✔ Updated '${product.name}' (${item.sku}) with exact GCS paths`);
  }

  console.log("\nAll product artwork paths successfully updated in database!");
}

applyGcsCatalogImages()
  .catch((err) => {
    console.error("Error applying GCS artwork:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
