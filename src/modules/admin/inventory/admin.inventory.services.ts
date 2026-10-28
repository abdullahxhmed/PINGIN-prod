import { Prisma, PrintBatchStatus, QrTagOrigin, QrTagStatus, QrTagStockState } from "@prisma/client";
import { BadRequestError, NotFoundError } from "../../../errors/AppError.js";
import { prisma } from "../../../lib/prisma.js";
import redis from "../../../lib/redis.js";
import { emailService as mailService } from "../../../emails/email.service.js";
import { resolveImageUrl } from "../../catalog/catalog-images.service.js";
import {
  generateOpaqueToken,
  generateTagNumber,
  hashQrToken,
} from "../../qr/qr.services.js";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function isUuid(val: string): boolean {
  return UUID_REGEX.test(val);
}

export interface ListTagInventoryQuery {
  page?: number | undefined;
  limit?: number | undefined;
  sku?: string | undefined;
  state?: QrTagStockState | undefined;
  search?: string | undefined;
}

export interface BatchGenerateTagsInput {
  sku: string;
  quantity: number;
  origin?: QrTagOrigin | undefined;
  idempotencyKey?: string | undefined;
}

export interface UpdateTagStateInput {
  state: QrTagStockState;
  reason?: string | undefined;
}

export interface UpsertBulkStockInput {
  sku: string;
  name: string;
  quantityOnHandDelta: number;
  reorderLevel?: number | undefined;
}

export interface UpsertPrintProfileInput {
  sku: string;
  name: string;
  widthMm: number;
  heightMm: number;
  shape?: string | undefined;
  material: string;
  finish: string;
  bleedMm?: number | undefined;
  safeMarginMm?: number | undefined;
  active?: boolean | undefined;
}

export interface CreatePrintTemplateInput {
  name: string;
  version?: number | undefined;
  isDefault?: boolean | undefined;
  qrXPosition?: number | undefined;
  qrYPosition?: number | undefined;
  qrSizeMm?: number | undefined;
  tagNumberPosition?: string | undefined;
  typographyJson?: any | undefined;
  brandingAssets?: any | undefined;
}

export interface CreatePrintBatchInput {
  sku: string;
  quantity: number;
  variantId?: string | undefined;
  vendorName?: string | undefined;
  templateId?: string | undefined;
  notes?: string | undefined;
  dispatchImmediately?: boolean | undefined;
}

export interface ListPrintBatchesQuery {
  page?: number | undefined;
  limit?: number | undefined;
  sku?: string | undefined;
  status?: PrintBatchStatus | undefined;
}

export interface InwardPrintBatchInput {
  batchIdentifier: string;
  receivedCount?: number | undefined;
  acceptedCount?: number | undefined;
  defectiveCount?: number | undefined;
  defectiveTagNumbers?: string[] | undefined;
  markAsFinalShipment?: boolean | undefined;
  notes?: string | undefined;
  receivedBy?: string | undefined;
  idempotencyKey?: string | undefined;
}

export interface ReceivePrintBatchInput {
  acceptedTagNumbers?: string[] | undefined;
  defectiveTagNumbers?: string[] | undefined;
  notes?: string | undefined;
  idempotencyKey?: string | undefined;
  receivedBy?: string | undefined;
}

import { getCommittedDemandBySku } from "../../inventory/inventory.services.js";

// ---------------------------------------------------------------------------
// 1. Inventory Summary (Serialized & Bulk)
// ---------------------------------------------------------------------------

export const adminGetInventorySummary = async () => {
  // Aggregate QrTagInventory by SKU and state, fetch committed demand, bulk stock, and tag counts in parallel
  const [serializedBySkuAndState, committedDemandMap, bulkStock, totalQrTags, totalAssignedOperational] =
    await Promise.all([
      prisma.qrTagInventory.groupBy({
        by: ["sku", "state"],
        _count: { id: true },
      }),
      getCommittedDemandBySku(),
      prisma.inventoryStock.findMany({
        orderBy: { sku: "asc" },
      }),
      prisma.qrTag.count(),
      prisma.qrTag.count({ where: { status: QrTagStatus.ASSIGNED } }),
    ]);

  // Calculate summary map: sku -> { generated, sentToPrint, inStock, physicalStock, committedDemand, paidUnfulfilledDemand, activeReservationsDemand, sellableStock, reserved, allocated, delivered, damaged, total }
  const skuMap: Record<
    string,
    {
      sku: string;
      generated: number;
      sentToPrint: number;
      inStock: number;
      physicalStock: number;
      committedDemand: number;
      paidUnfulfilledDemand: number;
      activeReservationsDemand: number;
      sellableStock: number;
      reserved: number;
      allocated: number;
      delivered: number;
      damaged: number;
      total: number;
    }
  > = {};

  // Initialize for all SKUs present in inventory or demand
  const allSkus = new Set<string>([
    ...serializedBySkuAndState.map((r) => r.sku),
    ...committedDemandMap.keys(),
  ]);

  for (const sku of allSkus) {
    const demand = committedDemandMap.get(sku);
    const paidUnfulfilled = demand?.paidUnfulfilledDemand || 0;
    const activeRes = demand?.activeReservationsDemand || 0;
    const totalCommitted = demand?.totalCommittedDemand || 0;

    skuMap[sku] = {
      sku,
      generated: 0,
      sentToPrint: 0,
      inStock: 0,
      physicalStock: 0,
      committedDemand: totalCommitted,
      paidUnfulfilledDemand: paidUnfulfilled,
      activeReservationsDemand: activeRes,
      sellableStock: 0,
      reserved: activeRes,
      allocated: 0,
      delivered: 0,
      damaged: 0,
      total: 0,
    };
  }

  for (const row of serializedBySkuAndState) {
    const count = row._count.id;
    skuMap[row.sku]!.total += count;

    if (row.state === QrTagStockState.GENERATED) skuMap[row.sku]!.generated += count;
    else if (row.state === QrTagStockState.SENT_TO_PRINT) skuMap[row.sku]!.sentToPrint += count;
    else if (row.state === QrTagStockState.IN_STOCK) skuMap[row.sku]!.inStock += count;
    else if (row.state === QrTagStockState.RESERVED) skuMap[row.sku]!.reserved += count;
    else if (row.state === QrTagStockState.ALLOCATED_TO_ORDER) skuMap[row.sku]!.allocated += count;
    else if (row.state === QrTagStockState.DELIVERED || row.state === QrTagStockState.DISPATCHED)
      skuMap[row.sku]!.delivered += count;
    else if (row.state === QrTagStockState.DAMAGED) skuMap[row.sku]!.damaged += count;
  }

  // Calculate sellable stock: max(0, physical in stock - committed demand)
  for (const item of Object.values(skuMap)) {
    item.physicalStock = item.inStock;
    item.sellableStock = Math.max(0, item.inStock - item.committedDemand);
  }

  const skuList = Object.values(skuMap);

  return {
    serializedBySku: skuList,
    bulkStock: bulkStock.map((b) => ({
      ...b,
      availableCount: b.quantityOnHand - b.reservedCount,
      isLowStock: b.quantityOnHand - b.reservedCount <= b.reorderLevel,
    })),
    totals: {
      totalPhysicalTags: totalQrTags,
      assignedToVehicles: totalAssignedOperational,
      inCommerceStock: skuList.reduce((acc, s) => acc + s.inStock, 0),
      physicalStock: skuList.reduce((acc, s) => acc + s.inStock, 0),
      totalCommittedDemand: skuList.reduce((acc, s) => acc + s.committedDemand, 0),
      paidUnfulfilledDemand: skuList.reduce((acc, s) => acc + s.paidUnfulfilledDemand, 0),
      reservedInCheckout: skuList.reduce((acc, s) => acc + s.activeReservationsDemand, 0),
      totalSellableStock: skuList.reduce((acc, s) => acc + s.sellableStock, 0),
    },
  };
};

// ---------------------------------------------------------------------------
// 2. Paginated Serialized Tag Inventory List
// ---------------------------------------------------------------------------

export const adminListTagInventory = async ({
  page = 1,
  limit = 50,
  sku,
  state,
  search,
}: ListTagInventoryQuery) => {
  const skip = (page - 1) * limit;

  const where: Record<string, unknown> = {};

  if (sku) where.sku = sku;
  if (state) where.state = state;
  if (search) {
    where.qrTag = {
      tagNumber: { contains: search.trim().toUpperCase(), mode: "insensitive" },
    };
  }

  const [total, records] = await prisma.$transaction([
    prisma.qrTagInventory.count({ where }),
    prisma.qrTagInventory.findMany({
      where,
      skip,
      take: limit,
      orderBy: { updatedAt: "desc" },
      include: {
        qrTag: {
          select: {
            id: true,
            tagNumber: true,
            origin: true,
            status: true,
            assignedAt: true,
            resource: {
              select: {
                id: true,
                name: true,
                user: { select: { id: true, name: true, mobileNumber: true } },
              },
            },
          },
        },
        activeReservation: {
          select: {
            id: true,
            checkoutSessionId: true,
            status: true,
            expiresAt: true,
          },
        },
      },
    }),
  ]);

  return {
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
    records: records.map((r) => ({
      id: r.id,
      qrTagId: r.qrTagId,
      tagNumber: r.qrTag.tagNumber,
      sku: r.sku,
      stockState: r.state,
      operationalStatus: r.qrTag.status,
      assignedVehicle: r.qrTag.resource
        ? {
            resourceId: r.qrTag.resource.id,
            name: r.qrTag.resource.name,
            ownerName: r.qrTag.resource.user.name,
          }
        : null,
      activeHold: r.activeReservation
        ? {
            reservationId: r.activeReservation.id,
            sessionId: r.activeReservation.checkoutSessionId,
            expiresAt: r.activeReservation.expiresAt,
          }
        : null,
      updatedAt: r.updatedAt,
    })),
  };
};

// ---------------------------------------------------------------------------
// 3. Batch Generate Preprinted Tags Bound to Product / SKU
// ---------------------------------------------------------------------------

export const adminBatchGenerateTags = async ({
  sku,
  quantity,
  origin = QrTagOrigin.PREPRINTED_INVENTORY,
  idempotencyKey,
}: BatchGenerateTagsInput) => {
  if (!sku) {
    throw new BadRequestError("SKU is required to bind physical tags to a product type.");
  }
  if (!quantity || quantity <= 0 || quantity > 5000) {
    throw new BadRequestError("Quantity must be between 1 and 5,000.");
  }

  const publicAppUrl = process.env.PUBLIC_APP_URL || "https://kauntact.in";

  // Check Redis idempotency cache if key provided
  if (idempotencyKey) {
    try {
      const cached = await redis.get(`idempotency:admin_batch:${idempotencyKey}`);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (err) {
      console.warn("Redis idempotency read failed:", err);
    }
  }

  const generatedItems: Array<{
    tagNumber: string;
    token: string;
    tokenHash: string;
  }> = [];

  const tagNumberSet = new Set<string>();

  for (let i = 0; i < quantity; i++) {
    let tagNumber = generateTagNumber();
    while (tagNumberSet.has(tagNumber)) {
      tagNumber = generateTagNumber();
    }
    tagNumberSet.add(tagNumber);

    const token = generateOpaqueToken();
    const tokenHash = hashQrToken(token);

    generatedItems.push({
      tagNumber,
      token,
      tokenHash,
    });
  }

  // Atomically create QrTag AND QrTagInventory
  await prisma.$transaction(async (tx) => {
    // 1. Insert QrTags
    await tx.qrTag.createMany({
      data: generatedItems.map((item) => ({
        tagNumber: item.tagNumber,
        tokenHash: item.tokenHash,
        origin,
        status: QrTagStatus.UNASSIGNED,
      })),
      skipDuplicates: true,
    });

    // 2. Fetch created IDs by tagNumbers
    const createdTags = await tx.qrTag.findMany({
      where: {
        tagNumber: { in: generatedItems.map((i) => i.tagNumber) },
      },
      select: { id: true, tagNumber: true },
    });

    // 3. Insert QrTagInventory records bound to this SKU with GENERATED state
    await tx.qrTagInventory.createMany({
      data: createdTags.map((t) => ({
        qrTagId: t.id,
        sku,
        state: QrTagStockState.GENERATED,
      })),
      skipDuplicates: true,
    });
  });

  const response = {
    batchId: idempotencyKey ?? `batch_${Date.now()}`,
    sku,
    count: generatedItems.length,
    origin,
    createdAt: new Date(),
    items: generatedItems.map((item) => ({
      tagNumber: item.tagNumber,
      token: item.token,
      qrUrl: `${publicAppUrl}/t/${item.token}`,
    })),
  };

  // Cache response for 24h if idempotencyKey provided
  if (idempotencyKey) {
    try {
      await redis.set(
        `idempotency:admin_batch:${idempotencyKey}`,
        JSON.stringify(response),
        "EX",
        86400
      );
    } catch (err) {
      console.warn("Redis idempotency write failed:", err);
    }
  }

  return response;
};

// ---------------------------------------------------------------------------
// 4. Update Tag Stock State (e.g. mark DAMAGED, RETURNED_TO_STOCK)
// ---------------------------------------------------------------------------

export const adminUpdateTagStockState = async (
  tagId: string,
  { state }: UpdateTagStateInput
) => {
  const inventoryRecord = await prisma.qrTagInventory.findFirst({
    where: {
      OR: [{ id: tagId }, { qrTagId: tagId }],
    },
    include: { qrTag: true },
  });

  if (!inventoryRecord) {
    throw new NotFoundError(`QR Tag inventory record '${tagId}' not found`);
  }

  return await prisma.$transaction(async (tx) => {
    // If marking as DAMAGED, also revoke operational status
    if (state === QrTagStockState.DAMAGED) {
      await tx.qrTag.update({
        where: { id: inventoryRecord.qrTagId },
        data: { status: QrTagStatus.REVOKED },
      });
    } else if (state === QrTagStockState.IN_STOCK || state === QrTagStockState.RETURNED_TO_STOCK) {
      // Re-activate operational status if it was unassigned
      if (inventoryRecord.qrTag.status === QrTagStatus.REVOKED) {
        await tx.qrTag.update({
          where: { id: inventoryRecord.qrTagId },
          data: { status: QrTagStatus.UNASSIGNED },
        });
      }
    }

    return await tx.qrTagInventory.update({
      where: { id: inventoryRecord.id },
      data: {
        state,
        activeReservationId: null, // Clear any active reservation hold
      },
      include: { qrTag: true },
    });
  });
};

// ---------------------------------------------------------------------------
// 5. Bulk Physical Stock Management
// ---------------------------------------------------------------------------

export const adminListBulkStock = async () => {
  const items = await prisma.inventoryStock.findMany({
    orderBy: { sku: "asc" },
  });

  return items.map((i) => ({
    ...i,
    availableCount: i.quantityOnHand - i.reservedCount,
    isLowStock: i.quantityOnHand - i.reservedCount <= i.reorderLevel,
  }));
};

export const adminUpsertBulkStock = async ({
  sku,
  name,
  quantityOnHandDelta,
  reorderLevel = 50,
}: UpsertBulkStockInput) => {
  const existing = await prisma.inventoryStock.findUnique({ where: { sku } });

  if (existing) {
    const newQuantity = existing.quantityOnHand + quantityOnHandDelta;
    if (newQuantity < 0) {
      throw new BadRequestError(
        `Cannot reduce stock below 0. Current on hand: ${existing.quantityOnHand}`
      );
    }
    const updated = await prisma.inventoryStock.update({
      where: { sku },
      data: {
        name,
        quantityOnHand: newQuantity,
        reorderLevel,
      },
    });

    mailService
      .checkAndAlertLowStock({ skus: [sku], triggeredBy: "Admin Bulk Stock Adjustment" })
      .catch(() => {});

    return updated;
  }

  if (quantityOnHandDelta < 0) {
    throw new BadRequestError("Initial quantity must be 0 or positive.");
  }

  const created = await prisma.inventoryStock.create({
    data: {
      sku,
      name,
      quantityOnHand: quantityOnHandDelta,
      reservedCount: 0,
      reorderLevel,
    },
  });

  mailService
    .checkAndAlertLowStock({ skus: [sku], triggeredBy: "Admin Bulk Stock Creation" })
    .catch(() => {});

  return created;
};

// ---------------------------------------------------------------------------
// 6. Print Profiles & Templates Management
// ---------------------------------------------------------------------------

export const ensureDefaultPrintProfiles = async () => {
  const defaults = [
    {
      sku: "KT-VS-SGL-LIT",
      name: "Vehicle Sticker (Light) - Windshield Vinyl",
      widthMm: 100.0,
      heightMm: 100.0,
      shape: "CIRCLE",
      material: "120 GSM Outdoor Vinyl",
      finish: "Matte UV Laminated",
      bleedMm: 2.0,
      safeMarginMm: 3.0,
      templateName: "KaunTact Official Light Vehicle Decal",
      qrSizeMm: 36.0,
    },
    {
      sku: "KT-VS-SGL-DRK",
      name: "Vehicle Sticker (Dark) - Windshield Vinyl",
      widthMm: 100.0,
      heightMm: 100.0,
      shape: "CIRCLE",
      material: "120 GSM Outdoor Vinyl",
      finish: "Matte UV Laminated",
      bleedMm: 2.0,
      safeMarginMm: 3.0,
      templateName: "KaunTact Official Dark Vehicle Decal",
      qrSizeMm: 36.0,
    },
    {
      sku: "KT-KC-SGL-LIT",
      name: "Smart Keychain Tag (Light) - Acrylic",
      widthMm: 80.0,
      heightMm: 40.0,
      shape: "ROUNDED_RECT",
      material: "Solid Acrylic / Epoxy",
      finish: "Gloss Double-Sided",
      bleedMm: 2.0,
      safeMarginMm: 3.0,
      templateName: "KaunTact Official Light Keychain Tag",
      qrSizeMm: 28.0,
    },
    {
      sku: "KT-KC-SGL-DRK",
      name: "Smart Keychain Tag (Dark) - Acrylic",
      widthMm: 80.0,
      heightMm: 40.0,
      shape: "ROUNDED_RECT",
      material: "Solid Acrylic / Epoxy",
      finish: "Gloss Double-Sided",
      bleedMm: 2.0,
      safeMarginMm: 3.0,
      templateName: "KaunTact Official Dark Keychain Tag",
      qrSizeMm: 28.0,
    },
    {
      sku: "KT-MS-SGL-LIT",
      name: "Mini Sticker (Light) - Helmet / Bike Decal",
      widthMm: 50.0,
      heightMm: 50.0,
      shape: "ROUNDED_RECT",
      material: "High-Tack Flexible Vinyl",
      finish: "Weatherproof Gloss",
      bleedMm: 1.5,
      safeMarginMm: 2.5,
      templateName: "KaunTact Official Light Mini Decal",
      qrSizeMm: 24.0,
    },
    {
      sku: "KT-MS-SGL-DRK",
      name: "Mini Sticker (Dark) - Helmet / Bike Decal",
      widthMm: 50.0,
      heightMm: 50.0,
      shape: "ROUNDED_RECT",
      material: "High-Tack Flexible Vinyl",
      finish: "Weatherproof Gloss",
      bleedMm: 1.5,
      safeMarginMm: 2.5,
      templateName: "KaunTact Official Dark Mini Decal",
      qrSizeMm: 24.0,
    },
  ];

  for (const def of defaults) {
    const existing = await prisma.printProfile.findUnique({
      where: { sku: def.sku },
      include: { templates: true },
    });

    if (!existing) {
      await prisma.printProfile.create({
        data: {
          sku: def.sku,
          name: def.name,
          widthMm: def.widthMm,
          heightMm: def.heightMm,
          shape: def.shape,
          material: def.material,
          finish: def.finish,
          bleedMm: def.bleedMm,
          safeMarginMm: def.safeMarginMm,
          templates: {
            create: {
              name: def.templateName,
              version: 1,
              isDefault: true,
              qrSizeMm: def.qrSizeMm,
              tagNumberPosition: "BELOW_QR",
            },
          },
        },
      });
    }
  }
};

export const adminGetPrintProfile = async (sku: string) => {
  await ensureDefaultPrintProfiles();

  const profile = await prisma.printProfile.findUnique({
    where: { sku },
    include: {
      templates: {
        where: { active: true },
        orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
      },
    },
  });

  if (!profile) {
    throw new NotFoundError(`No PrintProfile found for SKU '${sku}'`);
  }

  return profile;
};

export const adminUpsertPrintProfile = async (input: UpsertPrintProfileInput) => {
  const profile = await prisma.printProfile.upsert({
    where: { sku: input.sku },
    update: {
      name: input.name,
      widthMm: input.widthMm,
      heightMm: input.heightMm,
      shape: input.shape ?? "RECTANGLE",
      material: input.material,
      finish: input.finish,
      bleedMm: input.bleedMm ?? 2.0,
      safeMarginMm: input.safeMarginMm ?? 3.0,
      active: input.active ?? true,
    },
    create: {
      sku: input.sku,
      name: input.name,
      widthMm: input.widthMm,
      heightMm: input.heightMm,
      shape: input.shape ?? "RECTANGLE",
      material: input.material,
      finish: input.finish,
      bleedMm: input.bleedMm ?? 2.0,
      safeMarginMm: input.safeMarginMm ?? 3.0,
      active: input.active ?? true,
    },
  });

  // Auto-sync physical dimensions (mm -> cm) to associated Product catalog models
  try {
    const matchingComponents = await prisma.productComponent.findMany({
      where: { inventorySku: input.sku },
      include: { variant: { include: { product: true } } },
    });

    for (const comp of matchingComponents) {
      if (comp.variant?.product) {
        await prisma.product.update({
          where: { id: comp.variant.product.id },
          data: {
            lengthCm: Math.round((input.widthMm / 10) * 10) / 10,
            breadthCm: Math.round((input.heightMm / 10) * 10) / 10,
          },
        });
      }
    }
  } catch (err) {
    console.warn("Failed to auto-sync product dimensions from PrintProfile:", err);
  }

  return profile;
};

export const adminCreatePrintTemplate = async (
  profileId: string,
  input: CreatePrintTemplateInput
) => {
  const profile = await prisma.printProfile.findUnique({ where: { id: profileId } });
  if (!profile) {
    throw new NotFoundError(`PrintProfile '${profileId}' not found`);
  }

  return await prisma.$transaction(async (tx) => {
    if (input.isDefault) {
      // Unset previous defaults
      await tx.printTemplate.updateMany({
        where: { profileId, isDefault: true },
        data: { isDefault: false },
      });
    }

    return await tx.printTemplate.create({
      data: {
        profileId,
        name: input.name,
        version: input.version ?? 1,
        isDefault: input.isDefault ?? false,
        qrXPosition: input.qrXPosition ?? 0,
        qrYPosition: input.qrYPosition ?? 0,
        qrSizeMm: input.qrSizeMm ?? 30.0,
        tagNumberPosition: input.tagNumberPosition ?? "BELOW_QR",
        typographyJson: input.typographyJson ?? null,
        brandingAssets: input.brandingAssets ?? null,
      },
    });
  });
};

// ---------------------------------------------------------------------------
// 7. Print Batches (3 States: GENERATED -> PRINTING -> STOCKED)
// ---------------------------------------------------------------------------

export const adminCreatePrintBatch = async ({
  sku,
  quantity,
  variantId,
  vendorName,
  templateId,
  notes,
  dispatchImmediately = true,
}: CreatePrintBatchInput) => {
  if (!sku) {
    throw new BadRequestError("sku is required to create a print batch.");
  }
  if (!quantity || quantity <= 0) {
    throw new BadRequestError("quantity must be a positive integer.");
  }

  await ensureDefaultPrintProfiles();

  const profile = await prisma.printProfile.findUnique({
    where: { sku },
    include: { templates: true },
  });

  if (!profile) {
    throw new NotFoundError(`No PrintProfile found for SKU '${sku}'`);
  }

  const selectedTemplate = templateId
    ? profile.templates.find((t) => t.id === templateId)
    : profile.templates.find((t) => t.isDefault) || profile.templates[0];

  // Optional variant lookup & snapshot
  let variantSnapshot: any = null;
  let boundProductId: string | null = null;
  if (variantId) {
    const variant = await prisma.productVariant.findUnique({
      where: { id: variantId },
      include: { product: true, components: true },
    });
    if (!variant) {
      throw new NotFoundError(`ProductVariant '${variantId}' not found`);
    }
    boundProductId = variant.productId;
    const resolvedArtwork = await resolveImageUrl(variant.imageUrl || variant.product.imageUrl);
    variantSnapshot = {
      variantId: variant.id,
      variantSku: variant.sku,
      variantName: variant.name,
      productId: variant.productId,
      productName: variant.product.name,
      productType: variant.product.type,
      imageUrl: resolvedArtwork?.url || variant.imageUrl || variant.product.imageUrl || null,
      lengthCm: variant.product.lengthCm,
      breadthCm: variant.product.breadthCm,
      heightCm: variant.product.heightCm,
      weightGrams: variant.product.weightGrams,
    };
  }

  return await prisma.$transaction(async (tx) => {
    // 1. Atomically query available unbatched tags in GENERATED state
    const availableTags = await tx.qrTagInventory.findMany({
      where: {
        sku,
        state: QrTagStockState.GENERATED,
        printBatchId: null,
      },
      take: quantity,
      select: { id: true, qrTagId: true },
    });

    if (availableTags.length < quantity) {
      throw new BadRequestError(
        `Insufficient unprinted digital tags for SKU '${sku}'. Requested: ${quantity}, Available: ${availableTags.length}. Please generate digital tags first.`
      );
    }

    const tagIds = availableTags.map((t) => t.id);

    // 2. Format unique batch number
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const randomSuffix = Math.floor(1000 + Math.random() * 9000).toString();
    const skuCode = sku.replace("TAG-", "").slice(0, 4).toUpperCase();
    const batchNumber = `PRN-${skuCode}-${dateStr}-${randomSuffix}`;

    const profileSnapshot = {
      sku: profile.sku,
      name: profile.name,
      widthMm: profile.widthMm,
      heightMm: profile.heightMm,
      shape: profile.shape,
      material: profile.material,
      finish: profile.finish,
      bleedMm: profile.bleedMm,
      safeMarginMm: profile.safeMarginMm,
    };

    const templateSnapshot = selectedTemplate
      ? {
          id: selectedTemplate.id,
          name: selectedTemplate.name,
          version: selectedTemplate.version,
          qrSizeMm: selectedTemplate.qrSizeMm,
          tagNumberPosition: selectedTemplate.tagNumberPosition,
          qrXPosition: selectedTemplate.qrXPosition,
          qrYPosition: selectedTemplate.qrYPosition,
          typography: selectedTemplate.typographyJson,
          branding: selectedTemplate.brandingAssets,
        }
      : null;

    const initialStatus = dispatchImmediately
      ? PrintBatchStatus.PRINTING
      : PrintBatchStatus.GENERATED;

    const initialTagState = dispatchImmediately
      ? QrTagStockState.SENT_TO_PRINT
      : QrTagStockState.GENERATED;

    // 3. Create PrintBatch
    const batch = await tx.printBatch.create({
      data: {
        batchNumber,
        sku,
        status: initialStatus,
        vendorName: vendorName ?? null,
        variantId: variantId ?? null,
        productId: boundProductId,
        quantityRequested: quantity,
        quantityReceived: 0,
        quantityAccepted: 0,
        quantityDefective: 0,
        profileId: profile.id,
        templateId: selectedTemplate?.id ?? null,
        profileSnapshot: profileSnapshot as Prisma.InputJsonValue,
        templateSnapshot: templateSnapshot
          ? (templateSnapshot as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        variantSnapshot: variantSnapshot
          ? (variantSnapshot as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        dispatchedAt: dispatchImmediately ? new Date() : null,
        notes: notes ?? null,
      },
    });

    // 4. Assign tags to batch and update state
    await tx.qrTagInventory.updateMany({
      where: { id: { in: tagIds } },
      data: {
        printBatchId: batch.id,
        state: initialTagState,
      },
    });

    return {
      batchId: batch.id,
      batchNumber: batch.batchNumber,
      sku: batch.sku,
      quantityRequested: batch.quantityRequested,
      status: batch.status,
      vendorName: batch.vendorName,
      variantId: batch.variantId,
      productId: batch.productId,
      variant: variantSnapshot,
      profile: profileSnapshot,
      template: templateSnapshot,
      dispatchedAt: batch.dispatchedAt,
      tagCount: tagIds.length,
    };
  });
};

export const adminListPrintBatches = async ({
  page = 1,
  limit = 20,
  sku,
  status,
}: ListPrintBatchesQuery) => {
  const where: any = {};
  if (sku) where.sku = sku;
  if (status) where.status = status;

  const [total, batches] = await prisma.$transaction([
    prisma.printBatch.count({ where }),
    prisma.printBatch.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: "desc" },
      include: {
        profile: { select: { id: true, name: true, widthMm: true, heightMm: true } },
        template: { select: { id: true, name: true, version: true } },
        variant: { select: { id: true, name: true, sku: true, imageUrl: true } },
        product: { select: { id: true, name: true } },
      },
    }),
  ]);

  return {
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
    batches: batches.map((b) => ({
      id: b.id,
      batchNumber: b.batchNumber,
      sku: b.sku,
      status: b.status,
      vendorName: b.vendorName,
      variantId: b.variantId,
      productId: b.productId,
      variant: b.variant,
      product: b.product,
      quantityRequested: b.quantityRequested,
      quantityReceived: b.quantityReceived,
      quantityAccepted: b.quantityAccepted,
      quantityDefective: b.quantityDefective,
      outstanding: Math.max(0, b.quantityRequested - (b.quantityAccepted + b.quantityDefective)),
      profileSnapshot: b.profileSnapshot,
      templateSnapshot: b.templateSnapshot,
      variantSnapshot: b.variantSnapshot,
      dispatchedAt: b.dispatchedAt,
      stockedAt: b.stockedAt,
      createdAt: b.createdAt,
    })),
  };
};

export const adminGetPrintBatchById = async (batchIdentifier: string) => {
  const where = isUuid(batchIdentifier)
    ? { id: batchIdentifier }
    : { batchNumber: batchIdentifier };

  const batch = await prisma.printBatch.findFirst({
    where,
    include: {
      profile: true,
      template: true,
      variant: { include: { product: true } },
      product: true,
      receipts: { orderBy: { receivedAt: "desc" } },
      tags: {
        take: 100, // Preview up to 100 sample tags
        include: {
          qrTag: { select: { id: true, tagNumber: true, status: true } },
        },
      },
    },
  });

  if (!batch) {
    throw new NotFoundError(`PrintBatch '${batchIdentifier}' not found.`);
  }

  const batchId = batch.id;

  const [totalTags, receivedCount, defectiveCount, pendingCount] = await Promise.all([
    prisma.qrTagInventory.count({ where: { printBatchId: batchId } }),
    prisma.qrTagInventory.count({
      where: { printBatchId: batchId, state: QrTagStockState.IN_STOCK },
    }),
    prisma.qrTagInventory.count({
      where: { printBatchId: batchId, state: QrTagStockState.DAMAGED },
    }),
    prisma.qrTagInventory.count({
      where: { printBatchId: batchId, state: QrTagStockState.SENT_TO_PRINT },
    }),
  ]);

  const outstanding = Math.max(0, batch.quantityRequested - (batch.quantityAccepted + batch.quantityDefective));

  return {
    ...batch,
    stats: {
      totalAssignedTags: totalTags,
      quantityRequested: batch.quantityRequested,
      quantityReceived: batch.quantityReceived,
      quantityAccepted: batch.quantityAccepted,
      quantityDefective: batch.quantityDefective,
      outstanding,
      inwardedInStock: receivedCount,
      rejectedDamaged: defectiveCount,
      pendingAtVendor: pendingCount,
      isFullyStocked: batch.status === PrintBatchStatus.STOCKED,
    },
  };
};

export const adminDispatchPrintBatch = async (
  batchId: string,
  { vendorName }: { vendorName?: string } = {}
) => {
  const batch = await prisma.printBatch.findUnique({ where: { id: batchId } });
  if (!batch) {
    throw new NotFoundError(`PrintBatch '${batchId}' not found.`);
  }

  if (batch.status !== PrintBatchStatus.GENERATED) {
    throw new BadRequestError(`Only batches in 'GENERATED' status can be dispatched (current: ${batch.status})`);
  }

  return await prisma.$transaction(async (tx) => {
    await tx.qrTagInventory.updateMany({
      where: { printBatchId: batchId, state: QrTagStockState.GENERATED },
      data: { state: QrTagStockState.SENT_TO_PRINT },
    });

    return await tx.printBatch.update({
      where: { id: batchId },
      data: {
        status: PrintBatchStatus.PRINTING,
        vendorName: vendorName ?? batch.vendorName,
        dispatchedAt: new Date(),
      },
    });
  });
};

export const adminExportPrintBatchManifest = async (
  batchIdentifier: string,
  format: "csv" | "json" = "json"
) => {
  const publicAppUrl = process.env.PUBLIC_APP_URL || "https://kauntact.in";

  const where = isUuid(batchIdentifier)
    ? { id: batchIdentifier }
    : { batchNumber: batchIdentifier };

  const batch = await prisma.printBatch.findFirst({
    where,
    include: {
      variant: { include: { product: true } },
      product: true,
      tags: {
        orderBy: { id: "asc" },
        include: {
          qrTag: true,
        },
      },
    },
  });

  if (!batch) {
    throw new NotFoundError(`PrintBatch '${batchIdentifier}' not found.`);
  }

  const items = batch.tags.map((t, index) => ({
    sequenceNumber: index + 1,
    tagNumber: t.qrTag.tagNumber,
    sku: t.sku,
    qrUrl: `${publicAppUrl}/t/${t.qrTag.tagNumber}`,
    batchNumber: batch.batchNumber,
    state: t.state,
  }));

  if (format === "csv") {
    const header = "sequenceNumber,tagNumber,sku,qrUrl,batchNumber,state\n";
    const rows = items
      .map(
        (i) => `"${i.sequenceNumber}","${i.tagNumber}","${i.sku}","${i.qrUrl}","${i.batchNumber}","${i.state}"`
      )
      .join("\n");
    return header + rows;
  }

  return {
    batchNumber: batch.batchNumber,
    sku: batch.sku,
    quantityRequested: batch.quantityRequested,
    quantityAccepted: batch.quantityAccepted,
    quantityDefective: batch.quantityDefective,
    status: batch.status,
    vendorName: batch.vendorName,
    variantId: batch.variantId,
    productId: batch.productId,
    variantSnapshot: batch.variantSnapshot,
    profileSnapshot: batch.profileSnapshot,
    templateSnapshot: batch.templateSnapshot,
    totalTags: items.length,
    items,
  };
};

// ---------------------------------------------------------------------------
// 8. Warehouse Receiving & Stock Activation (Idempotent & Component-Safe)
// ---------------------------------------------------------------------------

export const adminInwardPrintBatch = async (input: InwardPrintBatchInput) => {
  const { batchIdentifier, idempotencyKey } = input;
  if (!batchIdentifier) {
    throw new BadRequestError("batchIdentifier is required to inward a batch.");
  }

  // 1. Check idempotency: if key provided and already processed, return existing receipt
  if (idempotencyKey) {
    const existingReceipt = await prisma.printBatchReceipt.findUnique({
      where: { idempotencyKey },
      include: {
        printBatch: {
          include: {
            variant: { include: { product: true } },
            product: true,
          },
        },
      },
    });

    if (existingReceipt) {
      const b = existingReceipt.printBatch;
      const totalInStock = await prisma.qrTagInventory.count({
        where: { sku: b.sku, state: QrTagStockState.IN_STOCK, activeReservationId: null },
      });
      return {
        batchId: b.id,
        batchNumber: b.batchNumber,
        sku: b.sku,
        batchStatus: b.status,
        receiptNumber: existingReceipt.receiptNumber,
        newlyAccepted: existingReceipt.acceptedQuantity,
        newlyDefective: existingReceipt.defectiveQuantity,
        totalReceived: b.quantityReceived,
        totalAccepted: b.quantityAccepted,
        totalDefective: b.quantityDefective,
        outstanding: Math.max(0, b.quantityRequested - (b.quantityAccepted + b.quantityDefective)),
        totalSellableInStockForSku: totalInStock,
        isFullyStocked: b.status === PrintBatchStatus.STOCKED,
        isDuplicateRequest: true,
        receipt: existingReceipt,
      };
    }
  }

  // 2. Fetch target batch with exclusive relation locks
  const where = isUuid(batchIdentifier)
    ? { id: batchIdentifier }
    : { batchNumber: batchIdentifier };

  const batch = await prisma.printBatch.findFirst({
    where,
    include: {
      receipts: { orderBy: { receivedAt: "desc" } },
      variant: true,
      product: true,
    },
  });

  if (!batch) {
    throw new NotFoundError(`PrintBatch '${batchIdentifier}' not found.`);
  }

  const outstandingBefore = Math.max(
    0,
    batch.quantityRequested - (batch.quantityAccepted + batch.quantityDefective)
  );

  // 3. Idempotency safeguard: if batch is already STOCKED with 0 outstanding
  if (batch.status === PrintBatchStatus.STOCKED && outstandingBefore === 0) {
    const latestReceipt = batch.receipts[0];
    const totalInStock = await prisma.qrTagInventory.count({
      where: { sku: batch.sku, state: QrTagStockState.IN_STOCK, activeReservationId: null },
    });
    return {
      batchId: batch.id,
      batchNumber: batch.batchNumber,
      sku: batch.sku,
      batchStatus: batch.status,
      receiptNumber: latestReceipt?.receiptNumber || `RCP-${batch.batchNumber}-FINAL`,
      newlyAccepted: 0,
      newlyDefective: 0,
      totalReceived: batch.quantityReceived,
      totalAccepted: batch.quantityAccepted,
      totalDefective: batch.quantityDefective,
      outstanding: 0,
      totalSellableInStockForSku: totalInStock,
      isFullyStocked: true,
      isDuplicateRequest: true,
      notes: "Batch is already fully STOCKED. No duplicate stock added.",
      receipt: latestReceipt || null,
    };
  }

  // 4. Calculate quantities for this receipt
  let defectiveCount = 0;
  let explicitDefectiveTagNumbers: string[] = [];

  if (input.defectiveTagNumbers && input.defectiveTagNumbers.length > 0) {
    explicitDefectiveTagNumbers = input.defectiveTagNumbers.map((t) => t.trim().toUpperCase());
    defectiveCount = explicitDefectiveTagNumbers.length;
  } else if (input.defectiveCount !== undefined) {
    defectiveCount = Math.max(0, input.defectiveCount);
  }

  // Default received count to outstanding tags if not explicitly given
  const receivedCount = input.receivedCount !== undefined
    ? Math.max(0, input.receivedCount)
    : outstandingBefore;

  const acceptedCount = input.acceptedCount !== undefined
    ? Math.max(0, input.acceptedCount)
    : Math.max(0, receivedCount - defectiveCount);

  if (acceptedCount + defectiveCount <= 0) {
    throw new BadRequestError("Total accepted and defective count must be greater than zero.");
  }

  if (acceptedCount + defectiveCount > outstandingBefore) {
    throw new BadRequestError(
      `Cannot inward ${acceptedCount + defectiveCount} tags. Only ${outstandingBefore} outstanding tags remain in batch '${batch.batchNumber}'.`
    );
  }

  // 5. Execute atomic transaction
  return await prisma.$transaction(async (tx) => {
    // Query available unreserved tags in batch ordered deterministically
    const eligibleTags = await tx.qrTagInventory.findMany({
      where: {
        printBatchId: batch.id,
        state: { in: [QrTagStockState.SENT_TO_PRINT, QrTagStockState.GENERATED] },
        activeReservationId: null,
      },
      orderBy: { id: "asc" },
      include: { qrTag: true },
    });

    if (eligibleTags.length < (acceptedCount + defectiveCount)) {
      throw new BadRequestError(
        `Insufficient tags in printable state for batch '${batch.batchNumber}'. Eligible: ${eligibleTags.length}, Requested: ${acceptedCount + defectiveCount}`
      );
    }

    const newlyDefectiveInventoryIds: string[] = [];
    const newlyDefectiveQrTagIds: string[] = [];
    const recordedDefectiveTagNumbers: string[] = [];

    // Map eligible tags for deterministic selection
    const tagMap = new Map(eligibleTags.map((t) => [t.qrTag.tagNumber.toUpperCase(), t]));
    const remainingEligible: typeof eligibleTags = [];

    // A. Process explicit defective tags if provided
    if (explicitDefectiveTagNumbers.length > 0) {
      for (const tagNum of explicitDefectiveTagNumbers) {
        const record = tagMap.get(tagNum);
        if (!record) {
          throw new BadRequestError(
            `Tag '${tagNum}' does not belong to unstocked tags in batch '${batch.batchNumber}'.`
          );
        }
        newlyDefectiveInventoryIds.push(record.id);
        newlyDefectiveQrTagIds.push(record.qrTagId);
        recordedDefectiveTagNumbers.push(record.qrTag.tagNumber);
        tagMap.delete(tagNum);
      }
      for (const record of eligibleTags) {
        if (tagMap.has(record.qrTag.tagNumber.toUpperCase())) {
          remainingEligible.push(record);
        }
      }
    } else if (defectiveCount > 0) {
      // Deterministically select the first N tags as defective
      const defectiveSelection = eligibleTags.slice(0, defectiveCount);
      for (const record of defectiveSelection) {
        newlyDefectiveInventoryIds.push(record.id);
        newlyDefectiveQrTagIds.push(record.qrTagId);
        recordedDefectiveTagNumbers.push(record.qrTag.tagNumber);
      }
      remainingEligible.push(...eligibleTags.slice(defectiveCount));
    } else {
      remainingEligible.push(...eligibleTags);
    }

    // B. Process accepted tags from remaining eligible
    const acceptedSelection = remainingEligible.slice(0, acceptedCount);
    const newlyAcceptedInventoryIds = acceptedSelection.map((t) => t.id);

    // C. Update defective tags -> DAMAGED & REVOKED
    if (newlyDefectiveInventoryIds.length > 0) {
      await tx.qrTagInventory.updateMany({
        where: { id: { in: newlyDefectiveInventoryIds } },
        data: { state: QrTagStockState.DAMAGED },
      });
      await tx.qrTag.updateMany({
        where: { id: { in: newlyDefectiveQrTagIds } },
        data: { status: QrTagStatus.REVOKED },
      });
    }

    // D. Update accepted tags -> IN_STOCK
    if (newlyAcceptedInventoryIds.length > 0) {
      await tx.qrTagInventory.updateMany({
        where: { id: { in: newlyAcceptedInventoryIds } },
        data: { state: QrTagStockState.IN_STOCK },
      });
    }

    // E. Update batch cumulative counters & lifecycle state
    const newQuantityReceived = batch.quantityReceived + receivedCount;
    const newQuantityAccepted = batch.quantityAccepted + acceptedCount;
    const newQuantityDefective = batch.quantityDefective + defectiveCount;
    const totalAccounted = newQuantityAccepted + newQuantityDefective;
    const remainingOutstanding = Math.max(0, batch.quantityRequested - totalAccounted);

    let nextStatus: PrintBatchStatus = PrintBatchStatus.PRINTING;
    if (totalAccounted >= batch.quantityRequested) {
      nextStatus = PrintBatchStatus.STOCKED;
    } else if (input.markAsFinalShipment) {
      nextStatus = PrintBatchStatus.RECONCILIATION_REQUIRED;
    } else {
      nextStatus = PrintBatchStatus.PARTIALLY_RECEIVED;
    }

    const updatedBatch = await tx.printBatch.update({
      where: { id: batch.id },
      data: {
        quantityReceived: newQuantityReceived,
        quantityAccepted: newQuantityAccepted,
        quantityDefective: newQuantityDefective,
        status: nextStatus,
        stockedAt: nextStatus === PrintBatchStatus.STOCKED ? new Date() : batch.stockedAt,
        notes: input.notes
          ? `${batch.notes ? batch.notes + " | " : ""}${input.notes}`
          : batch.notes,
      },
    });

    // F. Create immutable PrintBatchReceipt audit log
    const receiptIndex = batch.receipts.length + 1;
    const receiptNumber = `RCP-${batch.batchNumber}-${String(receiptIndex).padStart(2, "0")}`;

    const receipt = await tx.printBatchReceipt.create({
      data: {
        receiptNumber,
        printBatchId: batch.id,
        idempotencyKey: idempotencyKey || null,
        receivedQuantity: receivedCount,
        acceptedQuantity: acceptedCount,
        defectiveQuantity: defectiveCount,
        missingQuantity: input.markAsFinalShipment ? remainingOutstanding : 0,
        defectiveTagNumbers: recordedDefectiveTagNumbers.length > 0
          ? recordedDefectiveTagNumbers
          : Prisma.JsonNull,
        receivedBy: input.receivedBy || null,
        notes: input.notes || null,
      },
    });

    // G. Total sellable stock for this SKU
    const totalInStock = await tx.qrTagInventory.count({
      where: {
        sku: batch.sku,
        state: QrTagStockState.IN_STOCK,
        activeReservationId: null,
      },
    });

    return {
      batchId: updatedBatch.id,
      batchNumber: updatedBatch.batchNumber,
      sku: updatedBatch.sku,
      batchStatus: updatedBatch.status,
      receiptNumber: receipt.receiptNumber,
      newlyAccepted: acceptedCount,
      newlyDefective: defectiveCount,
      totalReceived: updatedBatch.quantityReceived,
      totalAccepted: updatedBatch.quantityAccepted,
      totalDefective: updatedBatch.quantityDefective,
      outstanding: remainingOutstanding,
      totalSellableInStockForSku: totalInStock,
      isFullyStocked: updatedBatch.status === PrintBatchStatus.STOCKED,
      isDuplicateRequest: false,
      receipt,
    };
  });
};

/**
 * Backward-compatible adapter for existing receiving endpoints & tests.
 */
export const adminReceivePrintBatch = async (
  batchId: string,
  input: ReceivePrintBatchInput
) => {
  const acceptedTagNumbers = input.acceptedTagNumbers || [];
  const defectiveTagNumbers = input.defectiveTagNumbers || [];

  if (acceptedTagNumbers.length === 0 && defectiveTagNumbers.length === 0) {
    // If empty arrays passed, treat as a full one-action batch receiving!
    return await adminInwardPrintBatch({
      batchIdentifier: batchId,
      notes: input.notes,
      receivedBy: input.receivedBy,
      idempotencyKey: input.idempotencyKey,
    });
  }

  return await adminInwardPrintBatch({
    batchIdentifier: batchId,
    receivedCount: acceptedTagNumbers.length + defectiveTagNumbers.length,
    acceptedCount: acceptedTagNumbers.length,
    defectiveCount: defectiveTagNumbers.length,
    defectiveTagNumbers: defectiveTagNumbers,
    notes: input.notes,
    receivedBy: input.receivedBy,
    idempotencyKey: input.idempotencyKey,
  });
};

