import { prisma } from "../../lib/prisma.js";
import { BadRequestError } from "../../errors/AppError.js";
import { shiprocketClient } from "../../integrations/shiprocket/shiprocket.client.js";
import type {
  ShippingRateRequestInput,
  ShippingRateResponseData,
  ShippingRatePackageDetails,
  ShippingRateCourierDetails,
} from "./shipping.types.js";

export const FREE_SHIPPING_THRESHOLD_PAISE = 40000; // ₹400 in paise

interface ResolvedCartItem {
  variantId: string;
  productId: string;
  productName: string;
  variantName: string;
  quantity: number;
  unitPrice: number; // in paise
  totalPrice: number; // in paise
  weightGrams: number;
  lengthCm: number;
  breadthCm: number;
  heightCm: number;
}

/**
 * Authoritatively resolves product and variant details from the database.
 * Computes merchandise subtotal and package dimensions without trusting client values.
 */
export async function resolveCartItems(
  items: ShippingRateRequestInput["items"]
): Promise<{
  resolvedItems: ResolvedCartItem[];
  subtotalAmount: number;
  packageDetails: ShippingRatePackageDetails;
}> {
  if (!items || items.length === 0) {
    throw new BadRequestError("Cart must contain at least one item to calculate shipping rates.");
  }

  const resolvedItems: ResolvedCartItem[] = [];
  let subtotalAmount = 0;
  let totalWeightGrams = 0;
  let maxLengthCm = 0;
  let maxBreadthCm = 0;
  let totalHeightCm = 0;

  for (const item of items) {
    let variant: any = null;

    if (item.variantId) {
      variant = await prisma.productVariant.findUnique({
        where: { id: item.variantId },
        include: { product: true },
      });
    } else if (item.productId) {
      // Handle cases where frontend passes variantId in productId, or a pure productId
      variant = await prisma.productVariant.findUnique({
        where: { id: item.productId },
        include: { product: true },
      });

      if (!variant) {
        const product = await prisma.product.findUnique({
          where: { id: item.productId },
          include: {
            variants: {
              where: { active: true },
              take: 1,
            },
          },
        });

        if (product && product.variants.length > 0) {
          variant = {
            ...product.variants[0],
            product,
          };
        }
      }
    }

    if (!variant || !variant.product || !variant.active || !variant.product.active) {
      throw new BadRequestError(
        `Item with identifier ${item.variantId || item.productId} was not found or is currently inactive.`
      );
    }

    const unitPrice = variant.price;
    const totalPrice = unitPrice * item.quantity;
    subtotalAmount += totalPrice;

    const weightGrams = variant.product.weightGrams ?? 100;
    const lengthCm = variant.product.lengthCm ?? 15;
    const breadthCm = variant.product.breadthCm ?? 10;
    const heightCm = variant.product.heightCm ?? 2;

    totalWeightGrams += weightGrams * item.quantity;
    maxLengthCm = Math.max(maxLengthCm, lengthCm);
    maxBreadthCm = Math.max(maxBreadthCm, breadthCm);
    totalHeightCm += heightCm * item.quantity;

    resolvedItems.push({
      variantId: variant.id,
      productId: variant.product.id,
      productName: variant.product.name,
      variantName: variant.name,
      quantity: item.quantity,
      unitPrice,
      totalPrice,
      weightGrams,
      lengthCm,
      breadthCm,
      heightCm,
    });
  }

  // Ensure realistic package constraints
  const packageDetails: ShippingRatePackageDetails = {
    weightGrams: Math.max(50, totalWeightGrams),
    dimensions: {
      lengthCm: Math.max(10, maxLengthCm),
      breadthCm: Math.max(10, maxBreadthCm),
      heightCm: Math.max(2, Math.min(100, totalHeightCm)),
    },
  };

  return {
    resolvedItems,
    subtotalAmount,
    packageDetails,
  };
}

/**
 * Calculates shipping rate for a cart based on authoritative database pricing,
 * the ₹400 (40,000 paise) free shipping rule, and Shiprocket live serviceability.
 */
export async function calculateShippingRates(
  input: ShippingRateRequestInput
): Promise<ShippingRateResponseData> {
  const { subtotalAmount, packageDetails } = await resolveCartItems(input.items);

  const isFreeShipping = subtotalAmount >= FREE_SHIPPING_THRESHOLD_PAISE;
  const pickupPostcode = process.env.SHIPROCKET_PICKUP_PINCODE || "560001";
  const weightKg = Math.max(0.05, packageDetails.weightGrams / 1000);

  // Check courier serviceability & live rates with Shiprocket
  const serviceability = await shiprocketClient.getCourierServiceability({
    pickupPostcode,
    deliveryPostcode: input.deliveryPincode,
    weightKg,
    cod: input.paymentMethod === "COD",
    lengthCm: packageDetails.dimensions.lengthCm,
    breadthCm: packageDetails.dimensions.breadthCm,
    heightCm: packageDetails.dimensions.heightCm,
    declaredValue: Math.round(subtotalAmount / 100),
  });

  if (!serviceability.isServiceable || !serviceability.cheapestCourier) {
    return {
      isServiceable: false,
      freeShippingThreshold: FREE_SHIPPING_THRESHOLD_PAISE,
      isFreeShipping,
      subtotalAmount,
      shippingFee: null,
      estimatedTax: 0,
      estimatedTotal: subtotalAmount,
      currency: "INR",
      deliveryPincode: input.deliveryPincode,
      paymentMethod: input.paymentMethod,
      courier: null,
      packageDetails,
      unserviceableReason: `Delivery is currently not available for postal code ${input.deliveryPincode}.`,
    };
  }

  const cheapestCourier = serviceability.cheapestCourier;
  // If qualified for free shipping, customer fee is 0 paise.
  // Otherwise, customer fee is the cheapest courier rate converted to paise (₹ * 100).
  const shippingFee = isFreeShipping ? 0 : Math.round(cheapestCourier.rate * 100);
  const estimatedTax = 0; // Tax is currently included or 0
  const estimatedTotal = subtotalAmount + shippingFee + estimatedTax;

  const courierDetails: ShippingRateCourierDetails = {
    name: "Express Delivery",
    estimatedDeliveryDays: cheapestCourier.estimatedDeliveryDays,
    etd: cheapestCourier.etd,
  };

  return {
    isServiceable: true,
    freeShippingThreshold: FREE_SHIPPING_THRESHOLD_PAISE,
    isFreeShipping,
    subtotalAmount,
    shippingFee,
    estimatedTax,
    estimatedTotal,
    currency: "INR",
    deliveryPincode: input.deliveryPincode,
    paymentMethod: input.paymentMethod,
    courier: courierDetails,
    packageDetails,
  };
}

/**
 * Helper used by checkout order creation to authoritatively compute shipping fee.
 */
export async function calculateShippingFeeForOrder(
  items: Array<{ variantId: string; quantity: number }>,
  deliveryPincode: string,
  paymentMethod: "PREPAID" | "COD" = "PREPAID"
): Promise<{
  shippingFee: number;
  subtotalAmount: number;
  courierName?: string | undefined;
}> {
  const result = await calculateShippingRates({
    items,
    deliveryPincode,
    paymentMethod,
  });

  if (!result.isServiceable || result.shippingFee === null) {
    throw new BadRequestError(
      result.unserviceableReason || `Delivery is not serviceable for postal code ${deliveryPincode}.`
    );
  }

  return {
    shippingFee: result.shippingFee,
    subtotalAmount: result.subtotalAmount,
    courierName: result.courier?.name,
  };
}
