export * from "./phone-encryption.js";
import { decryptData, decryptPhoneNumber } from "./phone-encryption.js";

/**
 * Decrypts all encrypted fields in a ShippingAddress object at rest.
 * Safe for null/undefined and backward compatible with plain text.
 */
export function decryptShippingAddress<
  T extends {
    fullName?: string | null;
    phoneNumber?: string | null;
    addressLine1?: string | null;
    addressLine2?: string | null;
    city?: string | null;
    state?: string | null;
    postalCode?: string | null;
    country?: string | null;
    [key: string]: any;
  } | null | undefined
>(address: T): T {
  if (!address) return address;
  return {
    ...address,
    fullName: address.fullName ? decryptData(address.fullName) : address.fullName,
    phoneNumber: address.phoneNumber ? decryptPhoneNumber(address.phoneNumber) : address.phoneNumber,
    addressLine1: address.addressLine1 ? decryptData(address.addressLine1) : address.addressLine1,
    addressLine2: address.addressLine2 ? decryptData(address.addressLine2) : address.addressLine2,
  };
}
