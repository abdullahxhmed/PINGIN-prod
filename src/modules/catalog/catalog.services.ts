import { ComponentType, ProductType } from "@prisma/client";
import { NotFoundError } from "../../errors/AppError.js";
import { prisma } from "../../lib/prisma.js";
import { resolveCatalogImages, resolveImageUrl, resolveVariantImages } from "./catalog-images.service.js";

async function getInventoryStockMap(): Promise<{
  serializedStock: Map<string, number>;
  physicalStock: Map<string, number>;
}> {
  const serializedCounts = await prisma.$queryRaw<Array<{ sku: string; count: bigint }>>`
    SELECT qi.sku, COUNT(q.id) as count
    FROM "QrTag" q
    JOIN "QrTagInventory" qi ON qi."qrTagId" = q.id
    WHERE q.status = 'UNASSIGNED'
      AND q.origin = 'PREPRINTED_INVENTORY'
      AND qi.state = 'IN_STOCK'
      AND qi."activeReservationId" IS NULL
    GROUP BY qi.sku;
  `;

  const serializedStock = new Map<string, number>();
  for (const row of serializedCounts) {
    serializedStock.set(row.sku, Number(row.count));
  }

  const physicalItems = await prisma.inventoryStock.findMany();
  const physicalStock = new Map<string, number>();
  for (const item of physicalItems) {
    const available = Math.max(0, item.quantityOnHand - item.reservedCount);
    physicalStock.set(item.sku, available);
  }

  return { serializedStock, physicalStock };
}

function attachAvailabilityToVariants<
  T extends {
    variants: Array<{
      id: string;
      components: Array<{
        id: string;
        componentType: ComponentType;
        inventorySku: string | null;
        quantity: number;
        name: string;
        plusDurationMonths?: number;
      }>;
    }>;
  }
>(product: T, stockMap: { serializedStock: Map<string, number>; physicalStock: Map<string, number> }) {
  const enrichedVariants = product.variants.map((v) => {
    let maxPossible = Infinity;
    let variantTagsCount = 0;
    let variantPlusMonths = 0;

    const componentsSummary = v.components.map((c) => {
      let availableInStock: number | null = null;
      let unitsPossible: number | null = null;

      if (c.componentType === ComponentType.SERIALIZED_QR_TAG) {
        variantTagsCount += c.quantity;
        if (c.inventorySku) {
          availableInStock = stockMap.serializedStock.get(c.inventorySku) || 0;
          unitsPossible = c.quantity > 0 ? Math.floor(availableInStock / c.quantity) : 0;
          if (unitsPossible < maxPossible) {
            maxPossible = unitsPossible;
          }
        }
      } else if (c.componentType === ComponentType.PHYSICAL_ITEM && c.inventorySku) {
        availableInStock = stockMap.physicalStock.get(c.inventorySku) || 0;
        unitsPossible = c.quantity > 0 ? Math.floor(availableInStock / c.quantity) : 0;
        if (unitsPossible < maxPossible) {
          maxPossible = unitsPossible;
        }
      } else if (c.componentType === ComponentType.DIGITAL_ENTITLEMENT) {
        variantPlusMonths += (c.plusDurationMonths || 0) * c.quantity;
      }

      return {
        ...c,
        availableStock: availableInStock,
        maxUnits: unitsPossible,
      };
    });

    const availableQuantity = maxPossible === Infinity ? 999999 : maxPossible;
    const inStock = availableQuantity > 0;

    return {
      ...v,
      tagsCount: variantTagsCount,
      plusMonths: variantPlusMonths,
      inStock,
      availableQuantity,
      components: componentsSummary,
    };
  });

  const productInStock = enrichedVariants.some((v) => v.inStock);
  const primaryVariant = enrichedVariants[0];

  return {
    ...product,
    inStock: productInStock,
    tagsCount: primaryVariant?.tagsCount ?? 0,
    plusMonths: primaryVariant?.plusMonths ?? 0,
    variants: enrichedVariants,
  };
}

import { seedDefaultStorefrontSlots } from "../admin/catalog/admin.storefront-slots.services.js";

export const listPublicCatalog = async () => {
  await seedDefaultStorefrontSlots();

  const [products, stockMap, activeSlots] = await Promise.all([
    prisma.product.findMany({
      where: { active: true },
      include: {
        variants: {
          where: { active: true },
          include: {
            components: true,
          },
        },
      },
      orderBy: [
        { displayOrder: "asc" },
        { createdAt: "asc" },
      ],
    }),
    getInventoryStockMap(),
    prisma.storefrontSlot.findMany({
      where: { active: true },
      include: {
        product: {
          select: { id: true, name: true, sku: true, slug: true, type: true, imageUrl: true, basePrice: true },
        },
        variant: {
          select: { id: true, name: true, price: true, sku: true, imageUrl: true },
        },
      },
      orderBy: { displayOrder: "asc" },
    }),
  ]);

  const mapped = products.map((p) => {
    const withAvail = attachAvailabilityToVariants(p, stockMap);
    const matchedSlots = activeSlots.filter((s) => s.productId === p.id);
    const primarySlot = matchedSlots[0];
    return {
      ...withAvail,
      storefrontSlot: primarySlot?.slotKey ?? null,
      storefrontSlotLabel: primarySlot?.label ?? null,
      storefrontSlotOrder: primarySlot?.displayOrder ?? 9999,
      storefrontSlots: matchedSlots.map((s) => ({
        slotKey: s.slotKey,
        label: s.label,
        displayOrder: s.displayOrder,
        variantId: s.variantId ?? null,
      })),
    };
  });

  const resolved = await Promise.all(mapped.map((p) => resolveCatalogImages(p)));

  // Sort so slotted products appear first in their defined slot order, followed by unslotted products
  resolved.sort((a, b) => {
    if (a.storefrontSlotOrder !== b.storefrontSlotOrder) {
      return a.storefrontSlotOrder - b.storefrontSlotOrder;
    }
    return (a.displayOrder ?? 0) - (b.displayOrder ?? 0);
  });

  // Construct slots lookup map for immediate O(1) storefront rendering
  const slotsMap: Record<string, any> = {};
  for (const s of activeSlots) {
    const slottedProduct = resolved.find((p) => p.id === s.productId) ?? null;
    if (!slottedProduct) {
      slotsMap[s.slotKey] = null;
      continue;
    }

    if (s.variantId) {
      // Find the specific variant bound to this slot
      const boundVariant = slottedProduct.variants?.find((v: any) => v.id === s.variantId) ?? null;
      if (boundVariant) {
        slotsMap[s.slotKey] = {
          ...slottedProduct,
          selectedVariantId: boundVariant.id,
          selectedVariant: boundVariant,
          // True variant-level card representation:
          name: `${slottedProduct.name} (${boundVariant.name})`,
          variantName: boundVariant.name,
          basePrice: boundVariant.price,
          imageUrl: boundVariant.imageUrl || slottedProduct.imageUrl,
          imageReference: (boundVariant as any).imageReference || slottedProduct.imageReference,
        };
      } else {
        slotsMap[s.slotKey] = slottedProduct;
      }
    } else {
      slotsMap[s.slotKey] = slottedProduct;
    }
  }

  // Resolve signed URLs for variant and product artwork in activeSlots
  const resolvedActiveSlots = await Promise.all(
    activeSlots.map(async (s) => {
      let resolvedProduct: any = s.product;
      if (s.product) {
        const pResolved = await resolveImageUrl(s.product.imageUrl);
        resolvedProduct = {
          ...s.product,
          imageUrl: pResolved?.url ?? s.product.imageUrl ?? null,
          imageReference: s.product.imageUrl ?? null,
        };
      }

      let resolvedVariant: any = s.variant;
      if (s.variant) {
        const rawVariantImg = s.variant.imageUrl || s.product?.imageUrl || null;
        const vResolved = await resolveImageUrl(rawVariantImg);
        resolvedVariant = {
          ...s.variant,
          imageUrl: vResolved?.url ?? rawVariantImg ?? null,
          imageReference: rawVariantImg,
        };
      }

      const slotImageUrl = resolvedVariant?.imageUrl || resolvedProduct?.imageUrl || null;
      const slotImageRef = resolvedVariant?.imageReference || resolvedProduct?.imageReference || null;

      return {
        ...s,
        imageUrl: slotImageUrl,
        imageReference: slotImageRef,
        product: resolvedProduct,
        variant: resolvedVariant,
      };
    })
  );

  // Attach slots dictionary directly to the returned array
  Object.assign(resolved, { slots: slotsMap, activeSlots: resolvedActiveSlots });

  return resolved;
};

export const getPublicStorefrontSlots = async () => {
  const products = await listPublicCatalog();
  const slots = (products as any).slots || {};
  const activeSlots = (products as any).activeSlots || [];
  return { slots, activeSlots, products };
};

export const getProductBySlug = async (slugOrId: string) => {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(slugOrId);

  const [product, stockMap] = await Promise.all([
    prisma.product.findFirst({
      where: {
        active: true,
        OR: [
          ...(isUuid ? [{ id: slugOrId }] : []),
          { slug: slugOrId },
        ],
      },
      include: {
        variants: {
          where: { active: true },
          include: { components: true },
        },
      },
    }),
    getInventoryStockMap(),
  ]);

  if (!product) {
    throw new NotFoundError(`Product '${slugOrId}' not found`);
  }

  const withAvailability = attachAvailabilityToVariants(product, stockMap);
  return await resolveCatalogImages(withAvailability);
};

export const getVariantById = async (variantId: string) => {
  const variant = await prisma.productVariant.findUnique({
    where: { id: variantId, active: true },
    include: {
      product: true,
      components: true,
    },
  });

  if (!variant) {
    throw new NotFoundError(`Product variant '${variantId}' not found`);
  }

  return await resolveVariantImages(variant);
};

export const seedDefaultCatalog = async () => {
  // 1. Vehicle Sticker (1 QR tag bound)
  await prisma.product.upsert({
    where: { sku: "PK-VEHICLE-STICKER" },
    update: {},
    create: {
      sku: "PK-VEHICLE-STICKER",
      name: "Vehicle QR Sticker",
      slug: "vehicle-qr-sticker",
      description: "Weather-resistant, UV-coated smart QR sticker designed for car windshields and rear windows.",
      type: ProductType.VEHICLE_STICKER,
      basePrice: 14900, // ₹149
      weightGrams: 30,
      lengthCm: 10.0,
      breadthCm: 10.0,
      heightCm: 0.5,
      variants: {
        create: {
          sku: "PK-VAR-STICKER-STD",
          name: "Standard Vehicle Sticker (1 Tag)",
          price: 14900,
          components: {
            create: [
              {
                componentType: ComponentType.SERIALIZED_QR_TAG,
                name: "Serialized QR Tag",
                quantity: 1,
                inventorySku: "TAG-VEHICLE-STICKER",
              },
            ],
          },
        },
      },
    },
  });

  // 2. Keychain (1 QR tag bound)
  await prisma.product.upsert({
    where: { sku: "PK-KEYCHAIN" },
    update: {},
    create: {
      sku: "PK-KEYCHAIN",
      name: "Smart QR Keychain",
      slug: "smart-qr-keychain",
      description: "Premium durable smart QR keychain for bike keys, car fobs, and bag tags.",
      type: ProductType.KEYCHAIN,
      basePrice: 19900, // ₹199
      weightGrams: 45,
      lengthCm: 8.0,
      breadthCm: 4.0,
      heightCm: 1.0,
      variants: {
        create: {
          sku: "PK-VAR-KEYCHAIN-STD",
          name: "Standard Smart Keychain (1 Tag)",
          price: 19900,
          components: {
            create: [
              {
                componentType: ComponentType.SERIALIZED_QR_TAG,
                name: "Serialized QR Tag",
                quantity: 1,
                inventorySku: "TAG-KEYCHAIN",
              },
            ],
          },
        },
      },
    },
  });

  // 3. Mini Sticker (1 QR tag bound)
  await prisma.product.upsert({
    where: { sku: "PK-MINI-STICKER" },
    update: {},
    create: {
      sku: "PK-MINI-STICKER",
      name: "Mini QR Sticker",
      slug: "mini-qr-sticker",
      description: "Compact waterproof QR sticker engineered for motorcycle helmets, bikes, and personal gear.",
      type: ProductType.MINI_STICKER,
      basePrice: 9900, // ₹99
      weightGrams: 15,
      lengthCm: 5.0,
      breadthCm: 5.0,
      heightCm: 0.2,
      variants: {
        create: {
          sku: "PK-VAR-MINI-STD",
          name: "Standard Mini Sticker (1 Tag)",
          price: 9900,
          components: {
            create: [
              {
                componentType: ComponentType.SERIALIZED_QR_TAG,
                name: "Serialized QR Tag",
                quantity: 1,
                inventorySku: "TAG-MINI-STICKER",
              },
            ],
          },
        },
      },
    },
  });

  // 4. All-in-One Trio Combo Pack (3 products, 3 QR tags + 12-Month Plus Service)
  await prisma.product.upsert({
    where: { sku: "PK-PACK-499" },
    update: {},
    create: {
      sku: "PK-PACK-499",
      name: "All-in-One Trio Pack + Plus Service",
      slug: "all-in-one-trio-pack-plus",
      description: "Complete security pack: 1 Vehicle Sticker + 1 Smart Keychain + 1 Mini Sticker (3 QR tags total) bundled with 12 months of Plus subscription service.",
      type: ProductType.COMBO_PACK,
      basePrice: 49900, // ₹499
      weightGrams: 120,
      lengthCm: 18.0,
      breadthCm: 12.0,
      heightCm: 3.0,
      variants: {
        create: {
          sku: "PK-VAR-499-STD",
          name: "Trio Pack (3 Tags + 12M Plus)",
          price: 49900,
          components: {
            create: [
              {
                componentType: ComponentType.SERIALIZED_QR_TAG,
                name: "Vehicle QR Sticker",
                quantity: 1,
                inventorySku: "TAG-VEHICLE-STICKER",
              },
              {
                componentType: ComponentType.SERIALIZED_QR_TAG,
                name: "Smart QR Keychain",
                quantity: 1,
                inventorySku: "TAG-KEYCHAIN",
              },
              {
                componentType: ComponentType.SERIALIZED_QR_TAG,
                name: "Mini QR Sticker",
                quantity: 1,
                inventorySku: "TAG-MINI-STICKER",
              },
              {
                componentType: ComponentType.DIGITAL_ENTITLEMENT,
                name: "12-Month Plus Subscription Service",
                quantity: 1,
                plusDurationMonths: 12,
              },
            ],
          },
        },
      },
    },
  });

  // 5. Digital Subscription Service Only (0 physical goods, 100% digital service)
  await prisma.product.upsert({
    where: { sku: "PK-PLUS-RENEWAL" },
    update: {},
    create: {
      sku: "PK-PLUS-RENEWAL",
      name: "12-Month Plus Service Renewal",
      slug: "plus-plan-renewal",
      description: "Digital subscription renewal granting 12 additional months of Plus plan service benefits. 0 physical goods.",
      type: ProductType.SUBSCRIPTION_ONLY,
      basePrice: 19900, // ₹199
      weightGrams: 0,
      variants: {
        create: {
          sku: "PK-VAR-RENEWAL-12M",
          name: "12 Months Plus Service",
          price: 19900,
          components: {
            create: [
              {
                componentType: ComponentType.DIGITAL_ENTITLEMENT,
                name: "12-Month Plus Extension",
                quantity: 1,
                plusDurationMonths: 12,
              },
            ],
          },
        },
      },
    },
  });
};
