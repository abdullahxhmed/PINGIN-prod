import { prisma } from "../lib/prisma.js";
import { createAtomicReservation } from "../modules/inventory/inventory.services.js";
import { createOrderFromCheckout } from "../modules/orders/orders.services.js";

async function main() {
  console.log("=== TESTING MULTI-ITEM CART RESERVATION & CHECKOUT ===\n");

  // 1. Locate 3 distinct variants: Keychain, Vehicle Sticker, Mini Sticker
  const [keychainVariant, vehicleVariant, miniVariant] = await Promise.all([
    prisma.productVariant.findFirst({
      where: { sku: "KT-KC-SGL-LIT" },
      include: { product: true },
    }),
    prisma.productVariant.findFirst({
      where: { sku: "KT-VS-SGL-LIT" },
      include: { product: true },
    }),
    prisma.productVariant.findFirst({
      where: { sku: "KT-MS-SGL-LIT" },
      include: { product: true },
    }),
  ]);

  if (!keychainVariant || !vehicleVariant || !miniVariant) {
    throw new Error("Could not find all 3 test variants (Keychain, Vehicle, Mini).");
  }

  console.log("Selected 3 distinct items for multi-item cart:");
  console.log(`  1. [${keychainVariant.sku}] ${keychainVariant.product.name} - ${keychainVariant.name} @ ₹${keychainVariant.price / 100}`);
  console.log(`  2. [${vehicleVariant.sku}] ${vehicleVariant.product.name} - ${vehicleVariant.name} @ ₹${vehicleVariant.price / 100}`);
  console.log(`  3. [${miniVariant.sku}] ${miniVariant.product.name} - ${miniVariant.name} @ ₹${miniVariant.price / 100}`);

  const expectedTotal = keychainVariant.price + vehicleVariant.price + miniVariant.price;
  console.log(`  -> Expected Total Price: ₹${expectedTotal / 100}\n`);

  // 2. Create Multi-Item Atomic Reservation
  const testSessionId = `test-multi-cart-${Date.now()}`;
  console.log(`-> Step 1: Reserving multi-item cart (Session: ${testSessionId})...`);

  const reservation = await createAtomicReservation({
    checkoutSessionId: testSessionId,
    items: [
      { variantId: keychainVariant.id, quantity: 1 },
      { variantId: vehicleVariant.id, quantity: 1 },
      { variantId: miniVariant.id, quantity: 1 },
    ],
  });

  console.log(`Reservation ID: ${reservation.id}, Status: ${reservation.status}`);
  console.log(`Reserved Items Count: ${reservation.items.length}`);
  for (const item of reservation.items) {
    console.log(`  - Variant: ${item.variant.name} (${item.variant.sku}), Qty: ${item.quantity}, Price: ₹${item.variant.price / 100}`);
  }

  if (reservation.items.length !== 3) {
    throw new Error(`Expected 3 reserved items, got ${reservation.items.length}`);
  }
  console.log("✓ Multi-item reservation created successfully.\n");

  // 3. Create Order from Checkout
  console.log("-> Step 2: Creating Order from Multi-Item Reservation...");
  const checkoutResult = await createOrderFromCheckout({
    checkoutSessionId: testSessionId,
    customerPhone: "9876543210",
    customerEmail: "tester@example.com",
    shippingAddress: {
      fullName: "Test Customer",
      phoneNumber: "9876543210",
      addressLine1: "123 Main Street",
      city: "Bengaluru",
      state: "Karnataka",
      postalCode: "560001",
      country: "IN",
    },
    checkoutIdempotencyKey: `chk-test-${Date.now()}`,
  });

  console.log(`Order Number: ${checkoutResult.orderNumber}`);
  console.log(`Total Amount: ₹${checkoutResult.amount / 100} ${checkoutResult.currency}`);
  console.log(`Razorpay Order ID: ${checkoutResult.razorpayOrderId}`);
  console.log(`Order Items Count: ${checkoutResult.items.length}`);
  for (const i of checkoutResult.items) {
    console.log(`  - ${i.variantName} x${i.quantity} @ ₹${i.unitPrice / 100} = ₹${i.totalPrice / 100}`);
  }

  if (checkoutResult.amount !== expectedTotal) {
    throw new Error(`Expected total ₹${expectedTotal / 100}, got ₹${checkoutResult.amount / 100}`);
  }

  if (checkoutResult.items.length !== 3) {
    throw new Error(`Expected 3 items in order, got ${checkoutResult.items.length}`);
  }

  console.log("✓ Multi-item order created with accurate pricing and separate line items!\n");

  console.log("==================================================================");
  console.log("🎉 MULTI-ITEM CART RESERVATION & CHECKOUT TEST PASSED!");
  console.log("==================================================================");
}

main()
  .catch((err) => {
    console.error("Test failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
