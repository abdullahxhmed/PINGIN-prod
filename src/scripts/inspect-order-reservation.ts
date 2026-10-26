import { prisma } from "../lib/prisma.js";

async function main() {
  const res = await prisma.inventoryReservation.findUnique({
    where: { checkoutSessionId: "e6433491-3ddf-4d64-8032-bf6fe618ec49" },
    include: {
      items: {
        include: {
          variant: {
            include: { product: true }
          }
        }
      },
      order: {
        include: {
          items: true
        }
      }
    }
  });

  console.log("=== RESERVATION FOR ORDER KT025614 ===");
  console.log(JSON.stringify(res, null, 2));
}

main().finally(async () => {
  await prisma.$disconnect();
});
