import { ComponentType, ProductType } from "@prisma/client";
import { BadRequestError, NotFoundError } from "../../../errors/AppError.js";
import { prisma } from "../../../lib/prisma.js";
import { resolveCatalogImages, verifyUploadedImageObject } from "../../catalog/catalog-images.service.js";

export interface AdminProductListQuery {
  page?: number | undefined;
  limit?: number | undefined;
  search?: string | undefined;
  type?: ProductType | undefined;
  activeOnly?: boolean | undefined;
}


export interface ComponentInput {
  componentType: ComponentType;
  name: string;
  quantity: number;
  plusDurationMonths?: number;
  inventorySku?: string;
}

export interface VariantInput {
  sku: string;
  name: string;
  price: number;
  imageUrl?: string | null | undefined;
  active?: boolean;
  components: ComponentInput[];
}

export interface CreateProductInput {
  sku: string;
  name: string;
  slug: string;
  description?: string | undefined;
  type?: ProductType | undefined;
  active?: boolean | undefined;
  basePrice: number;
  currency?: string | undefined;
  imageUrl?: string | null | undefined;
  isFeatured?: boolean | undefined;
  displayOrder?: number | undefined;
  weightGrams?: number | undefined;
  lengthCm?: number | undefined;
  breadthCm?: number | undefined;
  heightCm?: number | undefined;
  variants: VariantInput[];
}

export interface UpdateProductInput {
  name?: string | undefined;
  slug?: string | undefined;
  description?: string | undefined;
  type?: ProductType | undefined;
  active?: boolean | undefined;
  basePrice?: number | undefined;
  currency?: string | undefined;
  imageUrl?: string | null | undefined;
  isFeatured?: boolean | undefined;
  displayOrder?: number | undefined;
  weightGrams?: number | undefined;
  lengthCm?: number | undefined;
  breadthCm?: number | undefined;
  heightCm?: number | undefined;
}


// ---------------------------------------------------------------------------
// Validation helper: Image URLs and Cloud Bucket URIs
// ---------------------------------------------------------------------------
export function validateImageUrl(url: string | null | undefined, fieldName: string): void {
  if (url === undefined || url === null) return;
  const trimmed = url.trim();
  if (trimmed.length === 0) return;
  if (trimmed.length > 2048) {
    throw new BadRequestError(`${fieldName} must not exceed 2048 characters.`);
  }
  // Allow root-relative paths (e.g. /stickerImages/darkSet.PNG)
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) {
    return;
  }
  // Allow cloud bucket and standard protocols (http, https, gs, s3, r2)
  try {
    const parsed = new URL(trimmed);
    if (["http:", "https:", "gs:", "s3:", "r2:"].includes(parsed.protocol)) {
      return;
    }
  } catch {
    // Allow cloud bucket path identifiers (e.g., my-bucket/products/image.png)
    if (/^[a-zA-Z0-9_\-\.\/]+$/.test(trimmed)) {
      return;
    }
  }
  throw new BadRequestError(
    `${fieldName} contains an invalid URL or URI format. Received: '${url}'`
  );
}

// ---------------------------------------------------------------------------
// Validation helper: Every physical product MUST be bound to a QR tag component
// ---------------------------------------------------------------------------
function validateVariantComponents(type: ProductType, variantName: string, components: ComponentInput[]) {
  if (!components || components.length === 0) {
    throw new BadRequestError(`Variant '${variantName}' must define at least one component in its Bill of Materials.`);
  }

  for (const c of components) {
    if (c.quantity <= 0) {
      throw new BadRequestError(`Component '${c.name}' must have a quantity greater than 0.`);
    }
    if (c.componentType === ComponentType.SERIALIZED_QR_TAG && !c.inventorySku) {
      throw new BadRequestError(`Serialized QR tag component '${c.name}' must specify an inventorySku.`);
    }
    if (c.componentType === ComponentType.PHYSICAL_ITEM && !c.inventorySku) {
      throw new BadRequestError(`Physical item component '${c.name}' must specify an inventorySku.`);
    }
  }

  // Service products (Subscription Only) are purely digital services, NOT physical goods
  if (type === ProductType.SUBSCRIPTION_ONLY) {
    const hasPhysicalComponent = components.some(
      (c) => c.componentType === ComponentType.SERIALIZED_QR_TAG || c.componentType === ComponentType.PHYSICAL_ITEM
    );
    if (hasPhysicalComponent) {
      throw new BadRequestError(
        `Subscription service variant '${variantName}' is a digital service and cannot contain physical QR tags or physical items.`
      );
    }
    const hasDigitalService = components.some(
      (c) => c.componentType === ComponentType.DIGITAL_ENTITLEMENT && (c.plusDurationMonths ?? 0) > 0
    );
    if (!hasDigitalService) {
      throw new BadRequestError(
        `Subscription service variant '${variantName}' must include a DIGITAL_ENTITLEMENT component with positive plusDurationMonths.`
      );
    }
    return;
  }

  // Core ParkPing invariant for all physical product types:
  // (VEHICLE_STICKER, KEYCHAIN, MINI_STICKER, COMBO_PACK, PHYSICAL_TAG_PACK, MERCHANDISE)
  // Each physical product unit MUST have a QR tag bound to it.
  const serializedTagCount = components
    .filter((c) => c.componentType === ComponentType.SERIALIZED_QR_TAG)
    .reduce((sum, c) => sum + c.quantity, 0);

  if (serializedTagCount <= 0) {
    throw new BadRequestError(
      `Physical product variant '${variantName}' must include at least one SERIALIZED_QR_TAG component with a valid inventorySku (one tag per physical product).`
    );
  }
}

// ---------------------------------------------------------------------------
// Service Methods
// ---------------------------------------------------------------------------

export const adminListProducts = async ({
  page = 1,
  limit = 20,
  search,
  type,
  activeOnly,
}: AdminProductListQuery) => {
  const skip = (page - 1) * limit;
  const where: Record<string, unknown> = {};

  if (activeOnly) {
    where.active = true;
  }
  if (type) {
    where.type = type;
  }
  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { sku: { contains: search, mode: "insensitive" } },
      { slug: { contains: search, mode: "insensitive" } },
    ];
  }

  const [total, products] = await prisma.$transaction([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      skip,
      take: limit,
      orderBy: [{ displayOrder: "asc" }, { createdAt: "desc" }],
      include: {
        variants: {
          include: {
            components: true,
            _count: { select: { orderItems: true } },
          },
        },
      },
    }),
  ]);

  const resolvedProducts = await Promise.all(
    products.map(async (p) => {
      const resolved = await resolveCatalogImages(p);
      return {
        ...resolved,
        basePriceFormatted: `₹${(p.basePrice / 100).toFixed(2)}`,
        variantCount: p.variants.length,
      };
    })
  );

  return {
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
    products: resolvedProducts,
  };
};

export const adminGetProductById = async (productId: string) => {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: {
      variants: {
        include: {
          components: true,
          _count: { select: { orderItems: true } },
        },
      },
    },
  });

  if (!product) {
    throw new NotFoundError(`Product '${productId}' not found`);
  }

  return await resolveCatalogImages(product);
};

export const adminCreateProduct = async (input: CreateProductInput) => {
  const productType = input.type ?? ProductType.PHYSICAL_TAG_PACK;

  if (!input.variants || input.variants.length === 0) {
    throw new BadRequestError("At least one product variant is required.");
  }

  // Validate components for all variants
  for (const v of input.variants) {
    validateVariantComponents(productType, v.name, v.components);
  }

  // Validate image URLs and cloud bucket URIs
  validateImageUrl(input.imageUrl, "imageUrl");
  for (const v of input.variants) {
    if (v.imageUrl !== undefined) validateImageUrl(v.imageUrl, `variant[${v.sku}].imageUrl`);
  }

  // Verify GCS object integrity, size (<= 15MB), and binary magic bytes
  await Promise.all([
    verifyUploadedImageObject(input.imageUrl),
    ...input.variants
      .filter((v) => Boolean(v.imageUrl))
      .map((v) => verifyUploadedImageObject(v.imageUrl!)),
  ]);

  // Check unique constraints
  const existingSku = await prisma.product.findUnique({ where: { sku: input.sku } });
  if (existingSku) {
    throw new BadRequestError(`Product SKU '${input.sku}' is already taken.`);
  }

  const existingSlug = await prisma.product.findUnique({ where: { slug: input.slug } });
  if (existingSlug) {
    throw new BadRequestError(`Product slug '${input.slug}' is already taken.`);
  }

  return await prisma.$transaction(async (tx) => {
    const product = await tx.product.create({
      data: {
        sku: input.sku,
        name: input.name,
        slug: input.slug,
        description: input.description ?? null,
        type: productType,
        active: input.active ?? true,
        basePrice: input.basePrice,
        currency: input.currency ?? "INR",
        imageUrl: input.imageUrl ?? null,
        isFeatured: input.isFeatured ?? false,
        displayOrder: input.displayOrder ?? 0,
        weightGrams: input.weightGrams ?? 100,
        lengthCm: input.lengthCm ?? 15.0,
        breadthCm: input.breadthCm ?? 10.0,
        heightCm: input.heightCm ?? 2.0,
        variants: {
          create: input.variants.map((v) => ({
            sku: v.sku,
            name: v.name,
            price: v.price,
            imageUrl: v.imageUrl ?? null,
            active: v.active ?? true,
            components: {
              create: v.components.map((c) => ({
                componentType: c.componentType,
                name: c.name,
                quantity: c.quantity,
                plusDurationMonths: c.plusDurationMonths ?? 0,
                inventorySku: c.inventorySku ?? null,
              })),
            },
          })),
        },
      },
      include: {
        variants: {
          include: { components: true },
        },
      },
    });

    return await resolveCatalogImages(product);
  });
};

export const adminUpdateProduct = async (productId: string, input: UpdateProductInput) => {
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) {
    throw new NotFoundError(`Product '${productId}' not found`);
  }

  if (input.slug && input.slug !== product.slug) {
    const existingSlug = await prisma.product.findUnique({ where: { slug: input.slug } });
    if (existingSlug) {
      throw new BadRequestError(`Product slug '${input.slug}' is already taken.`);
    }
  }

  // Validate image URLs and cloud bucket URIs if updated
  if (input.imageUrl !== undefined) validateImageUrl(input.imageUrl, "imageUrl");

  // Verify GCS object integrity, size (<= 15MB), and binary magic bytes if updated
  if (input.imageUrl) {
    await verifyUploadedImageObject(input.imageUrl);
  }

  const updated = await prisma.$transaction(async (tx) => {
    const res = await tx.product.update({
      where: { id: productId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.slug !== undefined ? { slug: input.slug } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.type !== undefined ? { type: input.type } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
        ...(input.basePrice !== undefined ? { basePrice: input.basePrice } : {}),
        ...(input.currency !== undefined ? { currency: input.currency } : {}),
        ...(input.imageUrl !== undefined ? { imageUrl: input.imageUrl } : {}),
        ...(input.isFeatured !== undefined ? { isFeatured: input.isFeatured } : {}),
        ...(input.displayOrder !== undefined ? { displayOrder: input.displayOrder } : {}),
        ...(input.weightGrams !== undefined ? { weightGrams: input.weightGrams } : {}),
        ...(input.lengthCm !== undefined ? { lengthCm: input.lengthCm } : {}),
        ...(input.breadthCm !== undefined ? { breadthCm: input.breadthCm } : {}),
        ...(input.heightCm !== undefined ? { heightCm: input.heightCm } : {}),
      },
      include: {
        variants: { include: { components: true } },
      },
    });

    // If basePrice was changed and product has a single standard variant, keep variant price in sync
    if (input.basePrice !== undefined && res.variants.length === 1) {
      const singleVariant = res.variants[0];
      if (singleVariant) {
        await tx.productVariant.update({
          where: { id: singleVariant.id },
          data: { price: input.basePrice },
        });
        singleVariant.price = input.basePrice;
      }
    }

    return res;
  });

  return await resolveCatalogImages(updated);
};

export const adminCreateVariant = async (productId: string, input: VariantInput) => {
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) {
    throw new NotFoundError(`Product '${productId}' not found`);
  }

  validateVariantComponents(product.type, input.name, input.components);
  if (input.imageUrl !== undefined) validateImageUrl(input.imageUrl, "imageUrl");
  if (input.imageUrl) {
    await verifyUploadedImageObject(input.imageUrl);
  }

  const existingSku = await prisma.productVariant.findUnique({ where: { sku: input.sku } });
  if (existingSku) {
    throw new BadRequestError(`Variant SKU '${input.sku}' is already in use.`);
  }

  return await prisma.productVariant.create({
    data: {
      productId,
      sku: input.sku,
      name: input.name,
      price: input.price,
      imageUrl: input.imageUrl ?? null,
      active: input.active ?? true,
      components: {
        create: input.components.map((c) => ({
          componentType: c.componentType,
          name: c.name,
          quantity: c.quantity,
          plusDurationMonths: c.plusDurationMonths ?? 0,
          inventorySku: c.inventorySku ?? null,
        })),
      },
    },
    include: {
      components: true,
    },
  });
};

export const adminUpdateVariant = async (
  variantId: string,
  input: {
    name?: string;
    price?: number;
    imageUrl?: string | null | undefined;
    active?: boolean;
    components?: ComponentInput[];
  }
) => {
  const variant = await prisma.productVariant.findUnique({
    where: { id: variantId },
    include: { product: true },
  });

  if (!variant) {
    throw new NotFoundError(`Product variant '${variantId}' not found`);
  }

  if (input.imageUrl !== undefined) validateImageUrl(input.imageUrl, "imageUrl");
  if (input.imageUrl) {
    await verifyUploadedImageObject(input.imageUrl);
  }

  if (input.components) {
    validateVariantComponents(variant.product.type, input.name || variant.name, input.components);
  }

  return await prisma.$transaction(async (tx) => {
    // 1. Acquire row lock to prevent race conditions with concurrent cart reservations
    await tx.$queryRaw`
      SELECT id FROM "ProductVariant"
      WHERE id = ${variantId}::uuid
      FOR UPDATE
    `;

    if (input.components) {
      // 2. Guard against modifying components while unexpired active cart reservations exist
      const activeReservationCount = await tx.inventoryReservation.count({
        where: {
          status: "ACTIVE",
          expiresAt: { gt: new Date() },
          items: { some: { variantId } },
        },
      });

      if (activeReservationCount > 0) {
        throw new BadRequestError(
          `Cannot modify components while ${activeReservationCount} active checkout session(s) exist for this variant. Please wait for in-flight checkouts to settle (max 15 minutes) or deactivate the variant.`
        );
      }

      // Re-create components for this variant
      await tx.productComponent.deleteMany({ where: { variantId } });
      await tx.productComponent.createMany({
        data: input.components.map((c) => ({
          variantId,
          componentType: c.componentType,
          name: c.name,
          quantity: c.quantity,
          plusDurationMonths: c.plusDurationMonths ?? 0,
          inventorySku: c.inventorySku ?? null,
        })),
      });
    }

    return await tx.productVariant.update({
      where: { id: variantId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.price !== undefined ? { price: input.price } : {}),
        ...(input.imageUrl !== undefined ? { imageUrl: input.imageUrl } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
      },
      include: { components: true },
    });
  });
};

export const adminToggleProductActive = async (productId: string, active: boolean) => {
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) {
    throw new NotFoundError(`Product '${productId}' not found`);
  }

  return await prisma.product.update({
    where: { id: productId },
    data: { active },
    select: { id: true, sku: true, name: true, active: true },
  });
};

export const adminDeleteProduct = async (productId: string) => {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: {
      variants: {
        include: {
          _count: {
            select: {
              orderItems: true,
              reservationItems: true,
            },
          },
        },
      },
    },
  });

  if (!product) {
    throw new NotFoundError(`Product '${productId}' not found`);
  }

  const orderItemCount = product.variants.reduce((sum, v) => sum + v._count.orderItems, 0);
  const reservationCount = product.variants.reduce((sum, v) => sum + v._count.reservationItems, 0);

  if (orderItemCount > 0 || reservationCount > 0) {
    const deactivated = await prisma.product.update({
      where: { id: productId },
      data: { active: false },
    });
    return {
      deleted: false,
      deactivated: true,
      message: `Product '${product.name}' has historical order items (${orderItemCount}) or active reservations (${reservationCount}). It has been marked inactive rather than hard-deleted.`,
      product: deactivated,
    };
  }

  await prisma.product.delete({
    where: { id: productId },
  });

  return {
    deleted: true,
    deactivated: false,
    message: `Product '${product.name}' deleted successfully.`,
  };
};

export {
  listCatalogImagesInBucket,
  createUploadSignedUrl,
  uploadCatalogImageDirect,
} from "../../catalog/catalog-images.service.js";
