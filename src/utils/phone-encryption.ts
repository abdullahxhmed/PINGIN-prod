import "dotenv/config";
import crypto from "node:crypto";

export const DEFAULT_KEY_ID = "v1";

/**
 * Custom error thrown when required encryption/lookup environment configuration is missing or invalid.
 */
export class CryptographicConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CryptographicConfigurationError";
  }
}

/**
 * Custom error thrown when an encryption or decryption operation references an unknown Key ID.
 * Fail-closed security rule: Never silently fall back to an arbitrary key.
 */
export class KeyNotFoundError extends Error {
  constructor(keyId: string, availableKeys?: string[]) {
    const details = availableKeys && availableKeys.length > 0
      ? ` Available keys in keyring: [${availableKeys.join(", ")}]`
      : " Keyring is empty.";
    super(`Cryptographic key for Key ID '${keyId}' not found in Keyring.${details}`);
    this.name = "KeyNotFoundError";
  }
}

/**
 * Custom error thrown when ciphertext authentication fails (tampering, wrong key, or truncated payload).
 * Fail-closed security rule: Never return raw ciphertext or corrupted data to callers.
 */
export class DecryptionAuthenticationError extends Error {
  constructor(message = "Decryption authentication failed. Ciphertext may be corrupted, tampered with, or used an invalid key.") {
    super(message);
    this.name = "DecryptionAuthenticationError";
  }
}

/**
 * Returns the active key ID used for all new encryption operations.
 */
export const getActiveKeyId = (): string => {
  return process.env.ACTIVE_KEY_ID?.trim() || DEFAULT_KEY_ID;
};

/**
 * Returns the active Keyring dictionary of keyId -> 32-byte Buffer.
 * Supports:
 * 1. PHONE_ENCRYPTION_KEY / PHONE_ENCRYPTION_KEY_V1 (mapped to "v1")
 * 2. PHONE_ENCRYPTION_KEY_<KEY_ID> (e.g. PHONE_ENCRYPTION_KEY_V2 -> "v2")
 *
 * Strict security boundary: Never derives encryption keys from JWT_SECRET.
 */
export const getKeyRing = (): Map<string, Buffer> => {
  const ring = new Map<string, Buffer>();

  // Base key (v1)
  const defaultKeyBase64 = process.env.PHONE_ENCRYPTION_KEY_V1 || process.env.PHONE_ENCRYPTION_KEY;
  if (defaultKeyBase64) {
    try {
      const buf = Buffer.from(defaultKeyBase64, "base64");
      if (buf.length === 32) {
        ring.set(DEFAULT_KEY_ID, buf);
      } else {
        throw new CryptographicConfigurationError(
          `PHONE_ENCRYPTION_KEY must be exactly 32 bytes (256 bits) after Base64 decoding, got ${buf.length} bytes.`
        );
      }
    } catch (err: any) {
      if (err instanceof CryptographicConfigurationError) throw err;
      throw new CryptographicConfigurationError(`Invalid Base64 string for PHONE_ENCRYPTION_KEY: ${err.message}`);
    }
  }

  // Scan process.env for any other versioned keys: PHONE_ENCRYPTION_KEY_V2, etc.
  for (const [envName, envVal] of Object.entries(process.env)) {
    if (envName.startsWith("PHONE_ENCRYPTION_KEY_") && envVal) {
      const keyId = envName.replace("PHONE_ENCRYPTION_KEY_", "").toLowerCase();
      try {
        const buf = Buffer.from(envVal, "base64");
        if (buf.length === 32) {
          ring.set(keyId, buf);
        } else {
          throw new CryptographicConfigurationError(
            `Key '${envName}' must be exactly 32 bytes after Base64 decoding, got ${buf.length} bytes.`
          );
        }
      } catch (err: any) {
        if (err instanceof CryptographicConfigurationError) throw err;
        throw new CryptographicConfigurationError(`Invalid Base64 string for key '${envName}': ${err.message}`);
      }
    }
  }

  if (ring.size === 0) {
    throw new CryptographicConfigurationError(
      "PHONE_ENCRYPTION_KEY environment variable is missing. Explicit 256-bit key required."
    );
  }

  return ring;
};

/**
 * Retrieves the cryptographic key Buffer and Key ID for a given or active key version.
 * Fails closed if the requested key ID is not found in the keyring.
 */
export const getEncryptionKey = (keyId?: string): { key: Buffer; keyId: string } => {
  const ring = getKeyRing();
  const targetId = (keyId ? keyId.trim().toLowerCase() : getActiveKeyId().toLowerCase());
  const key = ring.get(targetId);

  if (!key) {
    throw new KeyNotFoundError(targetId, Array.from(ring.keys()));
  }

  return { key, keyId: targetId };
};

/**
 * Returns the active Lookup Secrets dictionary of lookupKeyId -> 32-byte Buffer.
 * Supports:
 * 1. PHONE_LOOKUP_SECRET / PHONE_LOOKUP_SECRET_V1 (mapped to "v1")
 * 2. PHONE_LOOKUP_SECRET_<KEY_ID> (e.g. PHONE_LOOKUP_SECRET_V2 -> "v2")
 *
 * Strict security boundary: Never derives lookup secrets from JWT_SECRET.
 */
export const getLookupRing = (): Map<string, Buffer> => {
  const ring = new Map<string, Buffer>();

  const defaultSecretBase64 = process.env.PHONE_LOOKUP_SECRET_V1 || process.env.PHONE_LOOKUP_SECRET;
  if (defaultSecretBase64) {
    try {
      const buf = Buffer.from(defaultSecretBase64, "base64");
      if (buf.length === 32) {
        ring.set(DEFAULT_KEY_ID, buf);
      } else {
        throw new CryptographicConfigurationError(
          `PHONE_LOOKUP_SECRET must be exactly 32 bytes after Base64 decoding, got ${buf.length} bytes.`
        );
      }
    } catch (err: any) {
      if (err instanceof CryptographicConfigurationError) throw err;
      throw new CryptographicConfigurationError(`Invalid Base64 string for PHONE_LOOKUP_SECRET: ${err.message}`);
    }
  }

  for (const [envName, envVal] of Object.entries(process.env)) {
    if (envName.startsWith("PHONE_LOOKUP_SECRET_") && envVal) {
      const keyId = envName.replace("PHONE_LOOKUP_SECRET_", "").toLowerCase();
      try {
        const buf = Buffer.from(envVal, "base64");
        if (buf.length === 32) {
          ring.set(keyId, buf);
        } else {
          throw new CryptographicConfigurationError(
            `Secret '${envName}' must be exactly 32 bytes after Base64 decoding, got ${buf.length} bytes.`
          );
        }
      } catch (err: any) {
        if (err instanceof CryptographicConfigurationError) throw err;
        throw new CryptographicConfigurationError(`Invalid Base64 string for secret '${envName}': ${err.message}`);
      }
    }
  }

  if (ring.size === 0) {
    throw new CryptographicConfigurationError(
      "PHONE_LOOKUP_SECRET environment variable is missing. Explicit 256-bit secret required."
    );
  }

  return ring;
};

/**
 * Retrieves the lookup secret Buffer for HMAC blind index calculation.
 */
export const getLookupSecret = (keyId?: string): { secret: Buffer; keyId: string } => {
  const ring = getLookupRing();
  const targetId = (keyId ? keyId.trim().toLowerCase() : DEFAULT_KEY_ID);
  const secret = ring.get(targetId);

  if (!secret) {
    throw new KeyNotFoundError(`Lookup secret '${targetId}'`, Array.from(ring.keys()));
  }

  return { secret, keyId: targetId };
};

/**
 * Checks if a string matches the format of an AES-256-GCM encrypted payload:
 * Versioned: keyId : base64(12-byte IV) : base64(ciphertext) : base64(16-byte AuthTag)
 * Legacy:    base64(12-byte IV) : base64(ciphertext) : base64(16-byte AuthTag)
 */
export const isEncrypted = (value?: string | null): boolean => {
  if (!value || typeof value !== "string") return false;
  const parts = value.split(":");
  if (parts.length === 4) {
    try {
      const iv = Buffer.from(parts[1]!, "base64");
      const tag = Buffer.from(parts[3]!, "base64");
      return Boolean(parts[0]) && iv.length === 12 && tag.length === 16 && Boolean(parts[2]);
    } catch {
      return false;
    }
  }
  if (parts.length === 3) {
    try {
      const iv = Buffer.from(parts[0]!, "base64");
      const tag = Buffer.from(parts[2]!, "base64");
      return iv.length === 12 && tag.length === 16 && Boolean(parts[1]);
    } catch {
      return false;
    }
  }
  return false;
};

/**
 * Extracts the Key ID from an encrypted payload, or returns DEFAULT_KEY_ID for legacy payloads.
 */
export const extractKeyId = (encryptedValue?: string | null): string | null => {
  if (!encryptedValue || !isEncrypted(encryptedValue)) return null;
  const parts = encryptedValue.split(":");
  if (parts.length === 4) {
    return parts[0]!;
  }
  return DEFAULT_KEY_ID;
};

/**
 * AES-256-GCM authenticated encryption at rest with Key-ID tracking and pure random 12-byte IV.
 * Format: keyId:base64(12-byte IV):base64(ciphertext):base64(16-byte tag)
 */
export const encryptData = (plainText: string, specificKeyId?: string): string => {
  if (!plainText) return "";
  const { key, keyId } = getEncryptionKey(specificKeyId);
  const iv = crypto.randomBytes(12);

  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  const cipherText = Buffer.concat([
    cipher.update(plainText, "utf-8"),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  return [
    keyId,
    iv.toString("base64"),
    cipherText.toString("base64"),
    authTag.toString("base64"),
  ].join(":");
};

/**
 * AES-256-GCM authenticated decryption.
 * Fail-Closed: Throws DecryptionAuthenticationError or KeyNotFoundError if ciphertext cannot be authenticated.
 * Returns plain string only if the input is unencrypted plain text (for backward compatibility).
 */
export const decryptData = (cipherOrPlain?: string | null): string => {
  if (!cipherOrPlain) return "";
  if (!isEncrypted(cipherOrPlain)) {
    return cipherOrPlain;
  }

  const parts = cipherOrPlain.split(":");
  let keyId = DEFAULT_KEY_ID;
  let ivBase64 = "";
  let cipherTextBase64 = "";
  let authTagBase64 = "";

  if (parts.length === 4) {
    keyId = parts[0]!;
    ivBase64 = parts[1]!;
    cipherTextBase64 = parts[2]!;
    authTagBase64 = parts[3]!;
  } else if (parts.length === 3) {
    keyId = DEFAULT_KEY_ID;
    ivBase64 = parts[0]!;
    cipherTextBase64 = parts[1]!;
    authTagBase64 = parts[2]!;
  } else {
    return cipherOrPlain;
  }

  // Fetch key; throws KeyNotFoundError if keyId is not recognized
  const { key } = getEncryptionKey(keyId);

  try {
    const iv = Buffer.from(ivBase64, "base64");
    const cipherText = Buffer.from(cipherTextBase64, "base64");
    const authTag = Buffer.from(authTagBase64, "base64");

    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);

    const plainText = Buffer.concat([
      decipher.update(cipherText),
      decipher.final(),
    ]);

    return plainText.toString("utf-8");
  } catch (err: any) {
    throw new DecryptionAuthenticationError(
      `Decryption authentication failed for keyId '${keyId}': ${err.message}`
    );
  }
};

/**
 * Normalizes Indian and international phone numbers into E.164 (+91XXXXXXXXXX) format.
 */
export const normalizePhoneNumber = (phoneNumber: string): string => {
  const cleaned = phoneNumber.replace(/[\s\-()]/g, "");

  if (cleaned.startsWith("+")) {
    return cleaned;
  }
  if (cleaned.startsWith("91") && cleaned.length === 12) {
    return `+${cleaned}`;
  }
  if (/^\d{10}$/.test(cleaned)) {
    return `+91${cleaned}`;
  }
  return `+91${cleaned}`;
};

/**
 * Encrypts a phone number with AES-256-GCM using a cryptographically secure random 12-byte IV.
 */
export const encryptPhoneNumber = (phoneNumber: string, keyId?: string): string => {
  const normalizedPhone = normalizePhoneNumber(phoneNumber);
  return encryptData(normalizedPhone, keyId);
};

/**
 * Decrypts a phone number with AES-256-GCM across all key versions.
 * Fails closed on authentication errors.
 */
export const decryptPhoneNumber = (encryptedOrPlain?: string | null): string => {
  if (!encryptedOrPlain) return "";
  if (!isEncrypted(encryptedOrPlain)) {
    return encryptedOrPlain;
  }
  return decryptData(encryptedOrPlain);
};

/**
 * Generates an HMAC-SHA256 blind index hash for phone number searches and unique lookups.
 * Safe for database indexing and equality searches at rest.
 */
export const generatePhoneLookup = (phoneNumber: string, lookupKeyId?: string): string => {
  const normalizedPhone = normalizePhoneNumber(phoneNumber);
  const { secret } = getLookupSecret(lookupKeyId);

  return crypto
    .createHmac("sha256", secret)
    .update(normalizedPhone)
    .digest("hex");
};

/**
 * Computes blind index hashes across all configured lookup secrets in the lookup ring.
 * Used during zero-downtime secret rotation to allow querying against old and new hashes.
 */
export const getAllPhoneLookups = (phoneNumber: string): string[] => {
  const normalizedPhone = normalizePhoneNumber(phoneNumber);
  const ring = getLookupRing();
  const lookups: string[] = [];

  for (const [, secret] of ring.entries()) {
    const hash = crypto
      .createHmac("sha256", secret)
      .update(normalizedPhone)
      .digest("hex");
    if (!lookups.includes(hash)) {
      lookups.push(hash);
    }
  }

  return lookups;
};

/**
 * Deterministic HMAC-SHA256 blind indexing for general searchable values.
 */
export const generateHmacLookup = (value: string, domain = "general", lookupKeyId?: string): string => {
  const { secret } = getLookupSecret(lookupKeyId);
  return crypto
    .createHmac("sha256", secret)
    .update(`${domain}:${value.trim().toLowerCase()}`)
    .digest("hex");
};

/**
 * Deprecated: Legacy deterministic phone encryption helper.
 * Kept only for transition/migration comparison and compatibility with unmigrated rows.
 * @deprecated Use encryptPhoneNumber (random IV) + mobileLookup (HMAC blind index) instead.
 */
export const encryptPhoneNumberDeterministic = (phoneNumber: string, specificKeyId?: string): string => {
  const normalizedPhone = normalizePhoneNumber(phoneNumber);
  const { key, keyId } = getEncryptionKey(specificKeyId);
  const { secret } = getLookupSecret();

  const iv = crypto
    .createHmac("sha256", secret)
    .update(`user_mobile:${normalizedPhone}`)
    .digest()
    .subarray(0, 12);

  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const cipherText = Buffer.concat([
    cipher.update(normalizedPhone, "utf-8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    keyId,
    iv.toString("base64"),
    cipherText.toString("base64"),
    authTag.toString("base64"),
  ].join(":");
};

/**
 * Helper to match user mobile numbers across legacy states during rollout.
 */
export const getPossibleUserMobileMatches = (phoneNumber: string): string[] => {
  const normalized = normalizePhoneNumber(phoneNumber);
  const legacyMatches = [phoneNumber, normalized];
  try {
    const versioned = encryptPhoneNumberDeterministic(phoneNumber);
    const parts = versioned.split(":");
    const legacy = parts.slice(1).join(":"); // iv:ciphertext:tag
    legacyMatches.push(versioned, legacy);
  } catch {
    // If deterministic key derivation fails, proceed with plaintext matches
  }
  return Array.from(new Set(legacyMatches));
};

/**
 * Masks a phone number for privacy in logs and UI responses (e.g. "+91 98••••••10").
 */
export const maskPhoneNumber = (phoneNumber: string): string => {
  const normalized = normalizePhoneNumber(phoneNumber);
  if (normalized.length <= 6) return normalized;
  const prefix = normalized.slice(0, 5);
  const suffix = normalized.slice(-2);
  const maskedLength = Math.max(2, normalized.length - prefix.length - suffix.length);
  return `${prefix} ${"•".repeat(maskedLength)} ${suffix}`;
};
