import dotenv from "dotenv";
dotenv.config();

import { prisma } from "../lib/prisma.js";

async function main() {
  console.log("=== CLEARING ALL PRODUCTS & BUNDLES (STARTING FRESH) ===\n");

  // 1. Check existing orders and reservations
  const [orderItemCount, reservationItemCount, productCount] = await Promise.all([
    prisma.orderItem.count(),
    prisma.reservationItem.count(),
    prisma.product.count(),
  ]);

  console.log(`Current counts: ${productCount} products, ${orderItemCount} orderItems, ${reservationItemCount} reservationItems.`);

  // 2. Clear relations to products
  await prisma.$transaction(async (tx) => {
    // Unassign products from StorefrontSlot
    await tx.storefrontSlot.updateMany({
      data: { productId: null },
    });
    console.log("✔ Cleared product assignments from all StorefrontSlots");

    // Clear slot history
    await tx.storefrontSlotHistory.deleteMany();
    console.log("✔ Cleared StorefrontSlotHistory");

    // Clear reserved tags and reservation items if any
    await tx.reservedTag.deleteMany();
    await tx.reservationItem.deleteMany();
    console.log("✔ Cleared reservation items");

    // Clear order items & test orders if any
    if (orderItemCount > 0) {
      await tx.paymentTransaction.deleteMany();
      await tx.subscriptionGrant.deleteMany();
      await tx.orderTagAllocation.deleteMany();
      await tx.packingScan.deleteMany();
      await tx.packingSession.deleteMany();
      await tx.shipment.deleteMany();
      await tx.purchaseClaim.deleteMany();
      await tx.shippingAddress.deleteMany();
      await tx.orderItem.deleteMany();
      await tx.order.deleteMany();
      await tx.inventoryReservation.deleteMany();
      console.log("✔ Cleared test order history referencing old product variants");
    }




    // Clear components, variants, and products
    await tx.productComponent.deleteMany();
    console.log("✔ Cleared ProductComponents");

    await tx.productVariant.deleteMany();
    console.log("✔ Cleared ProductVariants");

    await tx.product.deleteMany();
    console.log("✔ Cleared all Products");
  });

  const remainingProducts = await prisma.product.count();
  console.log(`\nRemaining products in database: ${remainingProducts}`);
  console.log("Google Cloud Storage images in bucket 'kauntact_product_images' were NOT deleted and remain 100% intact.");
  console.log("=== ALL PRODUCTS & BUNDLES CLEARED SUCCESSFULLY ===");
}

main()
  .catch((e) => {
    console.error("Failed to clear products:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
