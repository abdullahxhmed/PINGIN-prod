import { prisma } from "../lib/prisma.js";

interface DefaultProductArtwork {
  sku: string;
  imageUrl: string;
  isFeatured: boolean;
  displayOrder: number;
}

const DEFAULT_CATALOG_METADATA: DefaultProductArtwork[] = [
  {
    sku: "PK-PACK-179",
    imageUrl: "/stickerImages/darkDuo.PNG",
    isFeatured: false,
    displayOrder: 1,
  },
  {
    sku: "PK-PACK-499",
    imageUrl: "/stickerImages/darkSet.PNG",
    isFeatured: true,
    displayOrder: 2,
  },
  {
    sku: "PK-VEHICLE-STICKER",
    imageUrl: "/stickerImages/kauntactDark.png",
    isFeatured: false,
    displayOrder: 3,
  },
  {
    sku: "PK-KEYCHAIN",
    imageUrl: "/stickerImages/darkKeychain.PNG",
    isFeatured: false,
    displayOrder: 4,
  },
  {
    sku: "PK-MINI-STICKER",
    imageUrl: "/stickerImages/darkMini.PNG",
    isFeatured: false,
    displayOrder: 5,
  },
  {
    sku: "PK-PLUS-RENEWAL",
    imageUrl: "/stickerImages/darkDuo.PNG",
    isFeatured: false,
    displayOrder: 10,
  },
];

export async function backfillProductStorefrontFields(): Promise<void> {
  console.log("Starting repeatable product storefront metadata backfill...");

  for (const item of DEFAULT_CATALOG_METADATA) {
    const existing = await prisma.product.findUnique({
      where: { sku: item.sku },
      select: {
        id: true,
        sku: true,
        name: true,
        imageUrl: true,
        isFeatured: true,
        displayOrder: true,
      },
    });

    if (!existing) {
      console.log(`Product SKU '${item.sku}' not found in DB, skipping.`);
      continue;
    }

    // Guard: Only populate if fields are null / uninitialized, avoiding overwriting admin edits
    const hasExistingArtwork = Boolean(existing.imageUrl);
    if (hasExistingArtwork) {
      console.log(`Product '${existing.name}' (${existing.sku}) already has artwork configured. Preserving existing values.`);
      continue;
    }

    await prisma.product.update({
      where: { id: existing.id },
      data: {
        imageUrl: item.imageUrl,
        isFeatured: item.isFeatured,
        displayOrder: item.displayOrder,
      },
    });

    console.log(`Updated product '${existing.name}' (${existing.sku}) with default artwork & metadata.`);
  }

  console.log("Product storefront metadata backfill completed successfully.");
}

// Allow standalone execution
if (process.argv[1]?.endsWith("backfill-product-storefront-fields.ts")) {
  backfillProductStorefrontFields()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Backfill failed:", err);
      process.exit(1);
    });
}
