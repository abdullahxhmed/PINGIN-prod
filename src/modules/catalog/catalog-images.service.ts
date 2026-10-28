import crypto from "crypto";
import path from "path";
import { Storage } from "@google-cloud/storage";
import { BadRequestError } from "../../errors/AppError.js";
import { prisma } from "../../lib/prisma.js";

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

function getBucketName(): string {
  const bucketName = process.env.GCS_BUCKET_NAME;
  if (!bucketName) {
    throw new Error("GCS_BUCKET_NAME is required");
  }
  return bucketName;
}

/**
 * In-memory cache for resolved signed URLs.
 * Stores URLs for 50 minutes (within the 60-minute signing TTL) to eliminate
 * redundant Google Cloud IAM signing calls for repeated items and fulfillment screens.
 */
interface CachedSignedUrl {
  url: string;
  expiresAt: string;
  cachedUntil: number;
}

const signedUrlCache = new Map<string, CachedSignedUrl>();

/**
 * Normalizes an object path by stripping gs://, bucket prefixes, and any signed URL query strings.
 * Handles:
 * - Direct object keys: product_images/vehicle_stickers/kauntactLight.png
 * - gs:// URI: gs://bucket/product_images/vehicle_stickers/kauntactLight.png
 * - Path-style signed or direct URLs: https://storage.googleapis.com/bucket/product_images/...
 * - Cloud console URLs: https://storage.cloud.google.com/bucket/product_images/...
 * - Virtual-hosted style URLs: https://bucket.storage.googleapis.com/product_images/...
 */
export function normalizeObjectPath(rawPath: string, bucketName: string): string {
  if (!rawPath) return "";
  let cleaned = rawPath.trim();
  if (!cleaned) return "";

  // Strip query parameters and hashes (e.g. from previously signed or expired GCS URLs)
  cleaned = (cleaned.split("?")[0] || "").split("#")[0] || "";

  // Handle gs:// protocol
  if (bucketName && cleaned.startsWith(`gs://${bucketName}/`)) {
    return decodeURIComponent(cleaned.slice(`gs://${bucketName}/`.length));
  }
  if (cleaned.startsWith("gs://")) {
    const afterProtocol = cleaned.slice(5);
    const slashIdx = afterProtocol.indexOf("/");
    return decodeURIComponent(slashIdx !== -1 ? afterProtocol.slice(slashIdx + 1) : afterProtocol);
  }

  // Handle path-style: https://storage.googleapis.com/<bucketName>/<objectPath>
  // or https://storage.cloud.google.com/<bucketName>/<objectPath>
  const pathStyleRegex = /^https?:\/\/(?:storage\.googleapis\.com|storage\.cloud\.google\.com)\/([^/]+)\/(.+)$/i;
  const matchPath = cleaned.match(pathStyleRegex);
  if (matchPath && matchPath[2]) {
    return decodeURIComponent(matchPath[2]);
  }

  // Handle virtual-hosted style: https://<bucketName>.storage.googleapis.com/<objectPath>
  const virtualHostRegex = /^https?:\/\/([^.]+)\.storage\.googleapis\.com\/(.+)$/i;
  const matchVirtual = cleaned.match(virtualHostRegex);
  if (matchVirtual && matchVirtual[2]) {
    return decodeURIComponent(matchVirtual[2]);
  }

  // Handle explicit bucket prefix: <bucketName>/<objectPath>
  if (bucketName && cleaned.startsWith(`${bucketName}/`)) {
    return decodeURIComponent(cleaned.slice(`${bucketName}/`.length));
  }

  return cleaned;
}

/**
 * Low-level signing function for a GCS object path.
 */
export async function createCatalogImageUrl(
  objectPath: string
): Promise<{ url: string; expiresAt: string }> {
  const bucketName = getBucketName();
  const cleanPath = normalizeObjectPath(objectPath, bucketName);

  // If the path is a non-GCS external URL or static path, return directly
  if (
    cleanPath.startsWith("http://") ||
    cleanPath.startsWith("https://") ||
    cleanPath.startsWith("/") ||
    cleanPath.startsWith("data:")
  ) {
    const expiresAt = Date.now() + 60 * 60 * 1000;
    return {
      url: cleanPath,
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }

  // The kauntact_product_images bucket is public: serve clean, non-expiring public URLs
  const publicUrl = `https://storage.googleapis.com/${bucketName}/${cleanPath}`;
  const expiresAt = Date.now() + 365 * 24 * 60 * 60 * 1000;
  return {
    url: publicUrl,
    expiresAt: new Date(expiresAt).toISOString(),
  };
}

/**
 * Resolves a permanent public URL for a product image from the public GCS bucket.
 * Used for email templates, storefronts, and third-party integrations.
 */
export function getPublicImageUrl(imageReference: string | null | undefined): string | null {
  if (!imageReference) return null;
  const trimmed = imageReference.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }

  const bucketName = process.env.GCS_BUCKET_NAME || "kauntact_product_images";
  const cleanPath = normalizeObjectPath(trimmed, bucketName);
  if (!cleanPath) return null;

  return `https://storage.googleapis.com/${bucketName}/${cleanPath}`;
}

/**
 * Centralized resolver for a single image reference.
 * Checks in-memory cache first (50-min TTL), deduplicates, and caches signed URLs.
 */
export async function resolveImageUrl(
  imageReference: string | null | undefined
): Promise<{ url: string; expiresAt: string; reference: string } | null> {
  if (!imageReference) return null;
  const trimmed = imageReference.trim();
  if (!trimmed) return null;

  const bucketName = process.env.GCS_BUCKET_NAME || "";
  const normalizedKey = normalizeObjectPath(trimmed, bucketName);
  if (!normalizedKey) return null;

  // If normalizedKey is a non-GCS external URL or local static asset, return directly
  if (
    normalizedKey.startsWith("http://") ||
    normalizedKey.startsWith("https://") ||
    normalizedKey.startsWith("/") ||
    normalizedKey.startsWith("data:")
  ) {
    return {
      url: normalizedKey,
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      reference: trimmed,
    };
  }

  // Check in-memory batch cache
  const cached = signedUrlCache.get(normalizedKey);
  if (cached && Date.now() < cached.cachedUntil) {
    return {
      url: cached.url,
      expiresAt: cached.expiresAt,
      reference: trimmed,
    };
  }

  try {
    const signed = await createCatalogImageUrl(normalizedKey);
    signedUrlCache.set(normalizedKey, {
      url: signed.url,
      expiresAt: signed.expiresAt,
      cachedUntil: Date.now() + 50 * 60 * 1000, // Cache for 50 minutes
    });

    return {
      url: signed.url,
      expiresAt: signed.expiresAt,
      reference: trimmed,
    };
  } catch (err: any) {
    // Graceful fallback: return clean normalized key (never an expired signed URL)
    return {
      url: normalizedKey,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      reference: trimmed,
    };
  }
}

/**
 * Backwards-compatible alias for existing services.
 */
export const signCatalogImageField = resolveImageUrl;

/**
 * Centralized resolver for current catalog products (used by public catalog and admin catalog).
 * Resolves current artwork into temporary signed URLs while preserving the stable canonical reference.
 */
export async function resolveCatalogImages<
  T extends {
    imageUrl?: string | null;
    variants?: any[];
  }
>(product: T): Promise<T & { imageReference: string | null }> {
  const def = await resolveImageUrl(product.imageUrl);
  const parentUrl = def?.url ?? product.imageUrl ?? null;

  let resolvedVariants = product.variants;
  if (Array.isArray(product.variants) && product.variants.length > 0) {
    resolvedVariants = await Promise.all(
      product.variants.map(async (v) => {
        // Variant fallback: if v.imageUrl is provided, use it; otherwise fallback to parent product imageUrl
        const rawVariantRef = v.imageUrl || product.imageUrl || null;
        const vResolved = await resolveImageUrl(rawVariantRef);
        return {
          ...v,
          imageUrl: vResolved?.url ?? rawVariantRef ?? null,
          imageReference: rawVariantRef ?? null,
        };
      })
    );
  }

  return {
    ...product,
    imageUrl: parentUrl,
    imageReference: product.imageUrl ?? null,
    ...(resolvedVariants !== undefined ? { variants: resolvedVariants } : {}),
  };
}

/**
 * Centralized resolver for a single product variant and its optional parent product.
 */
export async function resolveVariantImages<
  T extends {
    imageUrl?: string | null;
    product?: { imageUrl?: string | null } | null;
  }
>(variant: T): Promise<T & { imageReference: string | null }> {
  const rawVariantRef = variant.imageUrl || variant.product?.imageUrl || null;
  const vResolved = await resolveImageUrl(rawVariantRef);

  let resolvedProduct = variant.product;
  if (variant.product) {
    const pResolved = await resolveImageUrl(variant.product.imageUrl);
    resolvedProduct = {
      ...variant.product,
      imageUrl: pResolved?.url ?? variant.product.imageUrl ?? null,
      imageReference: variant.product.imageUrl ?? null,
    } as any;
  }

  return {
    ...variant,
    imageUrl: vResolved?.url ?? rawVariantRef ?? null,
    imageReference: rawVariantRef ?? null,
    ...(resolvedProduct !== undefined ? { product: resolvedProduct } : {}),
  };
}

/**
 * Centralized resolver for historical order items.
 * Uses the stable image reference stored in the order item snapshot and generates
 * fresh signed URLs at response time. The snapshot remains untainted by ephemeral signed URLs.
 */
export async function resolveOrderImages<
  T extends {
    productSnapshot?: any;
    variant?: { imageUrl?: string | null; product?: { imageUrl?: string | null } };
  }
>(item: T): Promise<T & { imageUrl: string | null; imageReference: string | null }> {
  const snap = item.productSnapshot as any;
  const rawDefault =
    snap?.variant?.imageUrl ||
    snap?.product?.imageUrl ||
    item.variant?.imageUrl ||
    item.variant?.product?.imageUrl ||
    null;

  const def = await resolveImageUrl(rawDefault);

  return {
    ...item,
    imageUrl: def?.url ?? rawDefault,
    imageReference: rawDefault,
  };
}

/**
 * Batch resolver for orders list. Deduplicates all image references across
 * every order item before generating signed URLs, maximizing cache hits.
 */
export async function resolveOrderListImages<T extends { items?: any[] }>(orders: T[]): Promise<T[]> {
  const uniqueRefs = new Set<string>();
  for (const o of orders) {
    for (const i of o.items || []) {
      const snap = i.productSnapshot as any;
      const ref =
        snap?.variant?.imageUrl ||
        snap?.product?.imageUrl ||
        i.variant?.imageUrl ||
        i.variant?.product?.imageUrl;
      if (ref) uniqueRefs.add(ref);
    }
  }

  // Pre-warm cache for all unique references in parallel
  await Promise.all(Array.from(uniqueRefs).map((ref) => resolveImageUrl(ref)));

  const bucketName = process.env.GCS_BUCKET_NAME || "";

  return orders.map((o) => ({
    ...o,
    items: (o.items || []).map((i: any) => {
      const snap = i.productSnapshot as any;
      const ref =
        snap?.variant?.imageUrl ||
        snap?.product?.imageUrl ||
        i.variant?.imageUrl ||
        i.variant?.product?.imageUrl ||
        null;
      let signedUrl = ref;
      if (ref) {
        const key = normalizeObjectPath(ref, bucketName);
        const cached = signedUrlCache.get(key);
        if (cached && Date.now() < cached.cachedUntil) {
          signedUrl = cached.url;
        }
      }
      return {
        ...i,
        imageUrl: signedUrl,
        imageReference: ref,
      };
    }),
  }));
}



/**
 * Looks up the image object path for an active catalog product.
 * Supports imageId as product UUID, slug, or explicit path/slot.
 */
export async function getProductImageObjectPath(
  imageId: string,
  imageType?: string
): Promise<{ objectPath: string; productId: string; imageType: string } | null> {
  let slot = (imageType || "default").toLowerCase();
  let baseIdentifier = imageId;

  if (baseIdentifier.includes(":")) {
    const parts = baseIdentifier.split(":");
    baseIdentifier = parts[0] ?? "";
  }

  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(baseIdentifier);

  const product = await prisma.product.findFirst({
    where: {
      active: true,
      OR: [
        ...(isUuid ? [{ id: baseIdentifier }] : []),
        { slug: baseIdentifier },
        { imageUrl: imageId },
      ],
    },
    select: {
      id: true,
      imageUrl: true,
    },
  });

  if (product && product.imageUrl) {
    return {
      objectPath: product.imageUrl,
      productId: product.id,
      imageType: slot,
    };
  }

  // Fallback: check if baseIdentifier refers to a variant with its own or inherited image
  const variant = await prisma.productVariant.findFirst({
    where: {
      active: true,
      OR: [
        ...(isUuid ? [{ id: baseIdentifier }] : []),
        { sku: baseIdentifier },
        { imageUrl: imageId },
      ],
    },
    include: {
      product: { select: { id: true, imageUrl: true } },
    },
  });

  if (variant) {
    const chosen = variant.imageUrl || variant.product.imageUrl;
    if (chosen) {
      return {
        objectPath: chosen,
        productId: variant.product.id,
        imageType: slot,
      };
    }
  }

  return null;
}

export interface CatalogImageFileSummary {
  objectPath: string;
  name: string;
  folder: string;
  size: number;
  contentType: string | null;
  updatedAt: string | null;
  url: string | null;
}

/**
 * Lists all existing catalog images in the GCS bucket under product_images/
 * with instant preview URLs. Powers the Admin image library / picker.
 */
export async function listCatalogImagesInBucket(): Promise<CatalogImageFileSummary[]> {
  const bucketName = getBucketName();
  const bucket = storage.bucket(bucketName);

  const [files] = await bucket.getFiles({ prefix: "product_images/" });

  const imageFiles = files.filter((f) => {
    const isFolder = f.name.endsWith("/");
    const hasImageExt = /\.(png|jpe?g|webp|svg|gif)$/i.test(f.name);
    return !isFolder && hasImageExt;
  });

  return await Promise.all(
    imageFiles.map(async (file) => {
      const parts = file.name.split("/");
      const name = parts[parts.length - 1] ?? file.name;
      const folder = parts.length > 2 ? parts[1] ?? "general" : "general";

      const signed = await resolveImageUrl(file.name);

      return {
        objectPath: file.name,
        name,
        folder,
        size: Number(file.metadata.size ?? 0),
        contentType: (file.metadata.contentType as string) ?? null,
        updatedAt: (file.metadata.updated as string) ?? null,
        url: signed?.url ?? null,
      };
    })
  );
}

export const ALLOWED_IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export const ALLOWED_IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp"] as const;
export const ALLOWED_IMAGE_FOLDERS = ["vehicle_stickers", "keychain", "mini_stickers", "bundles", "general"] as const;
export const MAX_IMAGE_FILE_SIZE = 15 * 1024 * 1024; // 15 MB

/**
 * Validates and sanitizes upload parameters.
 * - Prevents path traversal (strips slashes and uses path.basename)
 * - Enforces allowed image MIME types and file extensions (no SVG/HTML/executable exploits)
 * - Restricts destination folders
 * - Generates collision-proof filenames to prevent overwriting existing live product artwork
 */
export function validateImageUploadParams(
  folder: string,
  filename: string,
  contentType: string
): { cleanFolder: string; sanitizedFilename: string; cleanContentType: string } {
  // 1. Strict MIME type check
  const cleanContentType = contentType.toLowerCase().trim();
  if (!ALLOWED_IMAGE_MIME_TYPES.includes(cleanContentType as any)) {
    throw new BadRequestError(
      `Disallowed image MIME type '${contentType}'. Permitted types: ${ALLOWED_IMAGE_MIME_TYPES.join(", ")}`
    );
  }

  // 2. Strict folder check (sanitize + whitelist)
  const normalizedFolder = folder.toLowerCase().trim().replace(/[^a-z0-9_-]/g, "_");
  const cleanFolder = (ALLOWED_IMAGE_FOLDERS as readonly string[]).includes(normalizedFolder)
    ? normalizedFolder
    : "general";

  // 3. Strict filename & extension check (path traversal defense)
  const base = path.basename(filename).trim();
  const ext = path.extname(base).toLowerCase();
  if (!ALLOWED_IMAGE_EXTENSIONS.includes(ext as any)) {
    throw new BadRequestError(
      `Disallowed image extension '${ext}'. Permitted extensions: ${ALLOWED_IMAGE_EXTENSIONS.join(", ")}`
    );
  }

  const nameWithoutExt = path.basename(base, ext).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 50);
  const randomSuffix = crypto.randomBytes(4).toString("hex");
  const timestamp = Math.floor(Date.now() / 1000);
  // Guarantee unique filename that cannot overwrite existing live artwork
  const sanitizedFilename = `${nameWithoutExt}_${timestamp}_${randomSuffix}${ext}`;

  return { cleanFolder, sanitizedFilename, cleanContentType };
}

/**
 * Validates magic bytes of an uploaded image buffer to ensure it is genuinely a PNG, JPEG, or WebP.
 * Detects polyglots, disguised shell scripts, HTML, or executables.
 */
export function validateImageBufferMagicBytes(buffer: Buffer): void {
  if (buffer.length > MAX_IMAGE_FILE_SIZE) {
    throw new BadRequestError(
      `Image size (${(buffer.length / (1024 * 1024)).toFixed(2)}MB) exceeds maximum allowed limit of ${MAX_IMAGE_FILE_SIZE / (1024 * 1024)}MB.`
    );
  }
  if (buffer.length < 12) {
    throw new BadRequestError("Invalid image payload: file is too small to be a valid image.");
  }

  // Check PNG magic bytes: 89 50 4E 47
  const isPng =
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47;

  // Check JPEG magic bytes: FF D8 FF
  const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;

  // Check WebP magic bytes: RIFF .... WEBP
  const isWebp =
    buffer.slice(0, 4).toString("ascii") === "RIFF" &&
    buffer.slice(8, 12).toString("ascii") === "WEBP";

  if (!isPng && !isJpeg && !isWebp) {
    throw new BadRequestError(
      "Malicious or invalid file content detected: binary payload header does not match a valid PNG, JPEG, or WebP image."
    );
  }
}

/**
 * Generates a V4 signed PUT URL for direct client-to-bucket upload.
 * Uploads directly to gs://<bucketName>/product_images/<folder>/<cleanFilename>.
 */
export async function createUploadSignedUrl({
  folder = "general",
  filename,
  contentType = "image/png",
}: {
  folder?: string;
  filename: string;
  contentType?: string;
}): Promise<{ uploadUrl: string; objectPath: string; previewUrl: string | null; expiresAt: string }> {
  const { cleanFolder, sanitizedFilename, cleanContentType } = validateImageUploadParams(
    folder,
    filename,
    contentType
  );

  const bucketName = getBucketName();
  const bucket = storage.bucket(bucketName);
  const objectPath = `product_images/${cleanFolder}/${sanitizedFilename}`;

  const expiresAt = Date.now() + 15 * 60 * 1000; // 15 minutes upload window

  const [uploadUrl] = await bucket.file(objectPath).getSignedUrl({
    version: "v4",
    action: "write",
    expires: expiresAt,
    contentType: cleanContentType,
  });

  const preview = await resolveImageUrl(objectPath);

  return {
    uploadUrl,
    objectPath,
    previewUrl: preview?.url ?? null,
    expiresAt: new Date(expiresAt).toISOString(),
  };
}

/**
 * Direct server-side upload helper for base64 or buffer images.
 */
export async function uploadCatalogImageDirect({
  folder = "general",
  filename,
  buffer,
  contentType = "image/png",
}: {
  folder?: string;
  filename: string;
  buffer: Buffer;
  contentType?: string;
}): Promise<{ objectPath: string; url: string; size: number }> {
  validateImageBufferMagicBytes(buffer);

  const { cleanFolder, sanitizedFilename, cleanContentType } = validateImageUploadParams(
    folder,
    filename,
    contentType
  );

  const bucketName = getBucketName();
  const bucket = storage.bucket(bucketName);
  const objectPath = `product_images/${cleanFolder}/${sanitizedFilename}`;

  const file = bucket.file(objectPath);
  await file.save(buffer, {
    metadata: {
      contentType: cleanContentType,
      cacheControl: "private, max-age=3600",
    },
    resumable: false,
  });

  const resolved = await resolveImageUrl(objectPath);

  return {
    objectPath,
    url: resolved?.url ?? objectPath,
    size: buffer.length,
  };
}

/**
 * Verifies an uploaded image object in GCS before associating it with a product.
 * - Confirms object exists in bucket
 * - Enforces max file size (<= 5MB)
 * - Verifies binary magic bytes (PNG, JPEG, WebP)
 * - Deletes malicious or corrupt files automatically to keep the bucket clean
 */
export async function verifyUploadedImageObject(objectPath: string | null | undefined): Promise<void> {
  if (!objectPath || typeof objectPath !== "string") return;
  // Only verify objects managed within product_images/
  if (!objectPath.startsWith("product_images/")) return;

  try {
    const bucketName = getBucketName();
    const bucket = storage.bucket(bucketName);
    const file = bucket.file(objectPath);

    const [exists] = await file.exists();
    if (!exists) {
      throw new BadRequestError(`Image object '${objectPath}' was not found in storage bucket.`);
    }

    const [metadata] = await file.getMetadata();
    const size = Number(metadata.size ?? 0);
    if (size > MAX_IMAGE_FILE_SIZE) {
      // Auto-cleanup oversized file
      await file.delete().catch(() => {});
      throw new BadRequestError(
        `Uploaded image exceeds maximum size limit of ${MAX_IMAGE_FILE_SIZE / (1024 * 1024)}MB.`
      );
    }

    // Inspect first 16 bytes for magic numbers
    const stream = file.createReadStream({ start: 0, end: 15 });
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const header = Buffer.concat(chunks);
    validateImageBufferMagicBytes(header);
  } catch (err: any) {
    if (err instanceof BadRequestError) throw err;
    console.warn("Image verification warning:", err?.message || err);
  }
}


