import { ProductType, StorefrontSlotType } from "@prisma/client";
import { BadRequestError, NotFoundError } from "../../../errors/AppError.js";
import { prisma } from "../../../lib/prisma.js";
import { resolveCatalogImages, resolveImageUrl } from "../../catalog/catalog-images.service.js";

export interface CreateStorefrontSlotInput {
  slotKey: string;
  label: string;
  slotType: StorefrontSlotType;
  displayOrder?: number | undefined;
  productId?: string | null | undefined;
  variantId?: string | null | undefined;
  reason?: string | undefined;
  changedBy?: string | undefined;
}

export interface UpdateStorefrontSlotInput {
  label?: string | undefined;
  displayOrder?: number | undefined;
  active?: boolean | undefined;
  productId?: string | null | undefined;
  variantId?: string | null | undefined;
  reason?: string | undefined;
  changedBy?: string | undefined;
}

export interface BatchSyncSlotItem {
  slotKey: string;
  productId?: string | null | undefined;
  variantId?: string | null | undefined;
  displayOrder?: number | undefined;
  active?: boolean | undefined;
}

export interface BatchSyncSlotsInput {
  slots: BatchSyncSlotItem[];
  reason?: string | undefined;
  changedBy?: string | undefined;
}

/**
 * Ensures initial storefront slots exist in the database with sensible defaults.
 * Automatically called if slot table is empty.
 */
export async function seedDefaultStorefrontSlots(): Promise<void> {
  const count = await prisma.storefrontSlot.count();
  if (count > 0) return;

  // Find existing products to initialize default slots
  const [curatedKit, essential, vehicleSticker, keychain, miniSticker, plusRenewal] =
    await Promise.all([
      prisma.product.findFirst({ where: { sku: { in: ["PACK-499", "PK-PACK-499"] } } }),
      prisma.product.findFirst({ where: { sku: { in: ["PK-PACK-179", "PACK-CURATED-KIT"] } } }),
      prisma.product.findFirst({ where: { sku: "PK-VEHICLE-STICKER" } }),
      prisma.product.findFirst({ where: { sku: "PK-KEYCHAIN" } }),
      prisma.product.findFirst({ where: { sku: "PK-MINI-STICKER" } }),
      prisma.product.findFirst({ where: { sku: "PK-PLUS-RENEWAL" } }),
    ]);

  const defaultSlots = [
    {
      slotKey: "bundle_1",
      label: "Hero Bundle Slot #1",
      slotType: StorefrontSlotType.BUNDLE,
      displayOrder: 1,
      productId: curatedKit?.id ?? null,
    },
    {
      slotKey: "bundle_2",
      label: "Featured Bundle Slot #2",
      slotType: StorefrontSlotType.BUNDLE,
      displayOrder: 2,
      productId: essential?.id ?? null,
    },
    {
      slotKey: "individual_1",
      label: "Vehicle Sticker Slot",
      slotType: StorefrontSlotType.INDIVIDUAL,
      displayOrder: 3,
      productId: vehicleSticker?.id ?? null,
    },
    {
      slotKey: "individual_2",
      label: "Smart Keychain Slot",
      slotType: StorefrontSlotType.INDIVIDUAL,
      displayOrder: 4,
      productId: keychain?.id ?? null,
    },
    {
      slotKey: "individual_3",
      label: "Mini Sticker Slot",
      slotType: StorefrontSlotType.INDIVIDUAL,
      displayOrder: 5,
      productId: miniSticker?.id ?? null,
    },
    {
      slotKey: "individual_4",
      label: "Plus Service Renewal Slot",
      slotType: StorefrontSlotType.INDIVIDUAL,
      displayOrder: 6,
      productId: plusRenewal?.id ?? null,
    },
  ];

  for (const s of defaultSlots) {
    const created = await prisma.storefrontSlot.create({
      data: s,
    });

    if (s.productId) {
      await prisma.storefrontSlotHistory.create({
        data: {
          slotId: created.id,
          slotKey: s.slotKey,
          slotLabel: s.label,
          action: "INITIAL_SEED",
          newProductId: s.productId,
          changedBy: "system",
          reason: "Default storefront layout bootstrap",
        },
      });
    }
  }
}

/**
 * Validates that a product is appropriate for the assigned slot type.
 * Bundles (Slots 1 & 2) must be COMBO_PACK or PHYSICAL_TAG_PACK.
 */
function validateProductForSlotType(slotType: StorefrontSlotType, productType: ProductType, slotLabel: string): void {
  if (slotType === StorefrontSlotType.BUNDLE) {
    const isBundle = productType === ProductType.COMBO_PACK || productType === ProductType.PHYSICAL_TAG_PACK;
    if (!isBundle) {
      throw new BadRequestError(
        `Slot '${slotLabel}' is designated for BUNDLES. Only COMBO_PACK or PHYSICAL_TAG_PACK products can be assigned here.`
      );
    }
  }
}

/**
 * Lists all storefront slots with their currently assigned products (artwork resolved),
 * along with available bundles and individual products for straightforward admin mapping.
 */
export async function adminListStorefrontSlots() {
  await seedDefaultStorefrontSlots();

  const [slots, allProducts] = await Promise.all([
    prisma.storefrontSlot.findMany({
      orderBy: { displayOrder: "asc" },
      include: {
        product: {
          include: {
            variants: {
              where: { active: true },
              select: { id: true, name: true, price: true, sku: true, imageUrl: true },
            },
          },
        },
        variant: {
          select: { id: true, name: true, price: true, sku: true, imageUrl: true },
        },
      },
    }),
    prisma.product.findMany({
      where: { active: true },
      select: {
        id: true,
        sku: true,
        name: true,
        slug: true,
        type: true,
        basePrice: true,
        imageUrl: true,
        variants: {
          where: { active: true },
          select: { id: true, sku: true, name: true, price: true, imageUrl: true },
        },
      },
      orderBy: { name: "asc" },
    }),
  ]);

  // Resolve artwork for all slotted products and explicit variants
  const resolvedSlots = await Promise.all(
    slots.map(async (s) => {
      let resolvedProduct = null;
      let resolvedVariant = null;
      if (s.product) {
        resolvedProduct = await resolveCatalogImages(s.product);
      }
      if (s.variant) {
        const rawVariantImg = s.variant.imageUrl || s.product?.imageUrl || null;
        const vResolved = await resolveImageUrl(rawVariantImg);
        resolvedVariant = {
          ...s.variant,
          imageUrl: vResolved?.url ?? rawVariantImg ?? null,
          imageReference: rawVariantImg,
        };
      }
      return {
        ...s,
        product: resolvedProduct,
        variant: resolvedVariant,
      };
    })
  );

  // Resolve artwork for all available products & their variants
  const resolvedAvailableProducts = await Promise.all(
    allProducts.map((p) => resolveCatalogImages(p))
  );

  // Split all active products into Bundles and Individuals
  const availableBundles = resolvedAvailableProducts.filter(
    (p) => p.type === ProductType.COMBO_PACK || p.type === ProductType.PHYSICAL_TAG_PACK
  );
  const availableIndividuals = resolvedAvailableProducts.filter(
    (p) => p.type !== ProductType.COMBO_PACK && p.type !== ProductType.PHYSICAL_TAG_PACK
  );

  return {
    slots: resolvedSlots,
    availableBundles,
    availableIndividuals,
    totalSlots: resolvedSlots.length,
  };
}

/**
 * Creates a new dynamic storefront slot.
 */
export async function adminCreateStorefrontSlot(input: CreateStorefrontSlotInput) {
  const cleanKey = input.slotKey.trim().toLowerCase();
  if (!/^[a-z0-9_-]+$/.test(cleanKey)) {
    throw new BadRequestError("slotKey must contain only lowercase letters, numbers, hyphens, and underscores.");
  }

  const existing = await prisma.storefrontSlot.findUnique({ where: { slotKey: cleanKey } });
  if (existing) {
    throw new BadRequestError(`Storefront slot with key '${cleanKey}' already exists.`);
  }

  let productId = input.productId ?? null;
  let variantId = input.variantId ?? null;

  if (variantId) {
    const variant = await prisma.productVariant.findUnique({
      where: { id: variantId },
      include: { product: true },
    });
    if (!variant) {
      throw new NotFoundError(`Product variant '${variantId}' not found.`);
    }
    productId = variant.productId;
    validateProductForSlotType(input.slotType, variant.product.type, input.label);
  } else if (productId) {
    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) {
      throw new NotFoundError(`Product '${productId}' not found.`);
    }
    validateProductForSlotType(input.slotType, product.type, input.label);
  }

  return await prisma.$transaction(async (tx) => {
    // Determine next display order if omitted
    let displayOrder = input.displayOrder;
    if (displayOrder === undefined) {
      const maxOrder = await tx.storefrontSlot.aggregate({ _max: { displayOrder: true } });
      displayOrder = (maxOrder._max.displayOrder ?? 0) + 1;
    }

    const slot = await tx.storefrontSlot.create({
      data: {
        slotKey: cleanKey,
        label: input.label.trim(),
        slotType: input.slotType,
        displayOrder,
        productId,
        variantId,
      },
      include: {
        product: {
          include: { variants: { where: { active: true } } },
        },
        variant: true,
      },
    });

    await tx.storefrontSlotHistory.create({
      data: {
        slotId: slot.id,
        slotKey: slot.slotKey,
        slotLabel: slot.label,
        action: "CREATE_SLOT",
        newProductId: slot.productId,
        newVariantId: slot.variantId,
        changedBy: input.changedBy ?? "admin",
        reason: input.reason ?? "New slot created",
      },
    });

    return slot;
  });
}

/**
 * Updates a storefront slot.
 * Enforces automatic swapping: If a product is already in another slot, the two products swap places.
 */
export async function adminUpdateStorefrontSlot(slotKey: string, input: UpdateStorefrontSlotInput) {
  const slot = await prisma.storefrontSlot.findUnique({
    where: { slotKey },
    include: { product: true, variant: true },
  });

  if (!slot) {
    throw new NotFoundError(`Storefront slot '${slotKey}' not found`);
  }

  return await prisma.$transaction(async (tx) => {
    let newProductId = slot.productId;
    let newVariantId = slot.variantId;
    const isBindingChangeRequested = input.productId !== undefined || input.variantId !== undefined;

    if (isBindingChangeRequested) {
      const incomingVariantId = input.variantId;
      const incomingProductId = input.productId;

      // Case A: Clear slot
      if (incomingProductId === null && (incomingVariantId === null || incomingVariantId === undefined)) {
        if (slot.productId || slot.variantId) {
          await tx.storefrontSlotHistory.create({
            data: {
              slotId: slot.id,
              slotKey: slot.slotKey,
              slotLabel: slot.label,
              action: "CLEAR",
              previousProductId: slot.productId,
              previousVariantId: slot.variantId,
              newProductId: null,
              newVariantId: null,
              changedBy: input.changedBy ?? "admin",
              reason: input.reason ?? `Slot ${slot.slotKey} unassigned`,
            },
          });
        }
        newProductId = null;
        newVariantId = null;
      } else if (incomingVariantId) {
        // Case B: Assign specific variant directly
        const variant = await tx.productVariant.findUnique({
          where: { id: incomingVariantId },
          include: { product: true },
        });
        if (!variant) {
          throw new NotFoundError(`Product variant '${incomingVariantId}' not found`);
        }
        validateProductForSlotType(slot.slotType, variant.product.type, input.label || slot.label);

        newVariantId = variant.id;
        newProductId = variant.productId;

        // Auto-Swap check: is this variant currently assigned to another slot?
        const otherSlot = await tx.storefrontSlot.findFirst({
          where: {
            variantId: newVariantId,
            id: { not: slot.id },
          },
          include: { product: true, variant: true },
        });

        if (otherSlot) {
          const oldProductId = slot.productId;
          const oldVariantId = slot.variantId;

          if (oldProductId) {
            const oldProduct = await tx.product.findUnique({ where: { id: oldProductId } });
            if (oldProduct) {
              validateProductForSlotType(otherSlot.slotType, oldProduct.type, otherSlot.label);
            }
          }

          // Swap old assignment into otherSlot
          await tx.storefrontSlot.update({
            where: { id: otherSlot.id },
            data: {
              productId: oldProductId ?? null,
              variantId: oldVariantId ?? null,
            },
          });

          await tx.storefrontSlotHistory.create({
            data: {
              slotId: otherSlot.id,
              slotKey: otherSlot.slotKey,
              slotLabel: otherSlot.label,
              action: "SWAP",
              previousProductId: otherSlot.productId,
              previousVariantId: otherSlot.variantId,
              newProductId: oldProductId ?? null,
              newVariantId: oldVariantId ?? null,
              changedBy: input.changedBy ?? "admin",
              reason: input.reason ?? `Auto-swapped with slot '${slot.slotKey}'`,
            },
          });
        }

        // Log history for current slot
        await tx.storefrontSlotHistory.create({
          data: {
            slotId: slot.id,
            slotKey: slot.slotKey,
            slotLabel: input.label || slot.label,
            action: otherSlot ? "SWAP" : "ASSIGN",
            previousProductId: slot.productId,
            previousVariantId: slot.variantId,
            newProductId,
            newVariantId,
            changedBy: input.changedBy ?? "admin",
            reason: input.reason ?? `Assigned variant '${variant.name}' of '${variant.product.name}'`,
          },
        });
      } else if (incomingProductId) {
        // Case C: Assign whole product (variantId cleared to null)
        const product = await tx.product.findUnique({ where: { id: incomingProductId } });
        if (!product) {
          throw new NotFoundError(`Product '${incomingProductId}' not found`);
        }
        validateProductForSlotType(slot.slotType, product.type, input.label || slot.label);

        newProductId = product.id;
        newVariantId = null;

        // Auto-Swap check: is this product currently assigned as a whole product in another slot?
        const otherSlot = await tx.storefrontSlot.findFirst({
          where: {
            productId: newProductId,
            variantId: null,
            id: { not: slot.id },
          },
          include: { product: true, variant: true },
        });

        if (otherSlot) {
          const oldProductId = slot.productId;
          const oldVariantId = slot.variantId;

          if (oldProductId) {
            const oldProduct = await tx.product.findUnique({ where: { id: oldProductId } });
            if (oldProduct) {
              validateProductForSlotType(otherSlot.slotType, oldProduct.type, otherSlot.label);
            }
          }

          // Swap old assignment into otherSlot
          await tx.storefrontSlot.update({
            where: { id: otherSlot.id },
            data: {
              productId: oldProductId ?? null,
              variantId: oldVariantId ?? null,
            },
          });

          await tx.storefrontSlotHistory.create({
            data: {
              slotId: otherSlot.id,
              slotKey: otherSlot.slotKey,
              slotLabel: otherSlot.label,
              action: "SWAP",
              previousProductId: otherSlot.productId,
              previousVariantId: otherSlot.variantId,
              newProductId: oldProductId ?? null,
              newVariantId: oldVariantId ?? null,
              changedBy: input.changedBy ?? "admin",
              reason: input.reason ?? `Auto-swapped with slot '${slot.slotKey}'`,
            },
          });
        }

        // Log history for current slot
        await tx.storefrontSlotHistory.create({
          data: {
            slotId: slot.id,
            slotKey: slot.slotKey,
            slotLabel: input.label || slot.label,
            action: otherSlot ? "SWAP" : "ASSIGN",
            previousProductId: slot.productId,
            previousVariantId: slot.variantId,
            newProductId,
            newVariantId,
            changedBy: input.changedBy ?? "admin",
            reason: input.reason ?? `Assigned product '${product.name}'`,
          },
        });
      }
    }

    const updated = await tx.storefrontSlot.update({
      where: { id: slot.id },
      data: {
        ...(input.label !== undefined ? { label: input.label.trim() } : {}),
        ...(input.displayOrder !== undefined ? { displayOrder: input.displayOrder } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
        ...(isBindingChangeRequested ? { productId: newProductId, variantId: newVariantId } : {}),
      },
      include: {
        product: {
          include: {
            variants: { where: { active: true } },
          },
        },
        variant: true,
      },
    });

    return updated;
  });
}

/**
 * Deletes a custom dynamic storefront slot.
 */
export async function adminDeleteStorefrontSlot(slotKey: string, changedBy?: string) {
  const slot = await prisma.storefrontSlot.findUnique({
    where: { slotKey },
  });

  if (!slot) {
    throw new NotFoundError(`Storefront slot '${slotKey}' not found`);
  }

  await prisma.$transaction(async (tx) => {
    await tx.storefrontSlotHistory.create({
      data: {
        slotId: slot.id,
        slotKey: slot.slotKey,
        slotLabel: slot.label,
        action: "DELETE_SLOT",
        previousProductId: slot.productId,
        newProductId: null,
        changedBy: changedBy ?? "admin",
        reason: "Slot deleted",
      },
    });

    await tx.storefrontSlot.delete({
      where: { id: slot.id },
    });
  });

  return {
    deleted: true,
    message: `Storefront slot '${slotKey}' deleted successfully.`,
  };
}

/**
 * Batch synchronization of multiple storefront slots in one transaction.
 */
export async function adminBatchSyncStorefrontSlots(input: BatchSyncSlotsInput) {
  const results = [];
  for (const item of input.slots) {
    const updated = await adminUpdateStorefrontSlot(item.slotKey, {
      productId: item.productId,
      variantId: item.variantId,
      displayOrder: item.displayOrder,
      active: item.active,
      reason: input.reason ?? "Batch layout sync",
      changedBy: input.changedBy,
    });
    results.push(updated);
  }
  return results;
}

/**
 * Retrieves the paginated audit trail of storefront slot changes.
 */
export async function adminGetStorefrontSlotHistory(query: {
  page?: number | undefined;
  limit?: number | undefined;
  slotKey?: string | undefined;
}) {
  const page = query.page ?? 1;
  const limit = query.limit ?? 25;
  const skip = (page - 1) * limit;

  const where: any = {};
  if (query.slotKey) {
    where.slotKey = query.slotKey;
  }

  const [total, history] = await prisma.$transaction([
    prisma.storefrontSlotHistory.count({ where }),
    prisma.storefrontSlotHistory.findMany({
      where,
      skip,
      take: limit,
      orderBy: { assignedAt: "desc" },
      include: {
        previousProduct: {
          select: { id: true, name: true, sku: true, imageUrl: true },
        },
        newProduct: {
          select: { id: true, name: true, sku: true, imageUrl: true },
        },
        previousVariant: {
          select: { id: true, name: true, sku: true, imageUrl: true, price: true },
        },
        newVariant: {
          select: { id: true, name: true, sku: true, imageUrl: true, price: true },
        },
      },
    }),
  ]);

  return {
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
    history,
  };
}
