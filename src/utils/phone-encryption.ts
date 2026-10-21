import crypto from "node:crypto";

const getEncryptionKey = (): Buffer => {
  const keyBase64 = process.env.PHONE_ENCRYPTION_KEY;
  if (!keyBase64) {
    throw new Error("PHONE_ENCRYPTION_KEY environment variable is missing");
  }
  const key = Buffer.from(keyBase64, "base64");
  if (key.length !== 32) {
    throw new Error("PHONE_ENCRYPTION_KEY must be exactly 32 bytes");
  }
  return key;
};

const getLookupSecret = (): Buffer => {
  const secretBase64 = process.env.PHONE_LOOKUP_SECRET;
  if (!secretBase64) {
    throw new Error("PHONE_LOOKUP_SECRET environment variable is missing");
  }
  const secret = Buffer.from(secretBase64, "base64");
  if (secret.length !== 32) {
    throw new Error("PHONE_LOOKUP_SECRET must be exactly 32 bytes");
  }
  return secret;
};

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

export const encryptPhoneNumber = (phoneNumber: string): string => {
  const normalizedPhone = normalizePhoneNumber(phoneNumber);
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);

  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  const cipherText = Buffer.concat([
    cipher.update(normalizedPhone, "utf-8"),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  return [
    iv.toString("base64"),
    cipherText.toString("base64"),
    authTag.toString("base64"),
  ].join(":");
};

export const decryptPhoneNumber = (encrypted: string): string => {
  const [ivBase64, cipherTextBase64, authTagBase64] = encrypted.split(":");

  if (!ivBase64 || !cipherTextBase64 || !authTagBase64) {
    throw new Error("Invalid encrypted phone number format");
  }

  const key = getEncryptionKey();
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
};

export const generatePhoneLookup = (phoneNumber: string): string => {
  const normalizedPhone = normalizePhoneNumber(phoneNumber);
  const secret = getLookupSecret();

  return crypto
    .createHmac("sha256", secret)
    .update(normalizedPhone)
    .digest("hex");
};
