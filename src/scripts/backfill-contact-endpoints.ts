import { prisma } from "../lib/prisma.js";

async function main() {
  const users = await prisma.user.findMany({
    where: {
      contactEndpoint: null,
    },
    select: {
      id: true,
      mobileNumber: true,
    },
  });

  console.log(`Found ${users.length} users without a ContactEndpoint`);

  for (const user of users) {
    await prisma.contactEndpoint.create({
      data: {
        userId: user.id,
        type: "PHONE",
        phoneNumber: user.mobileNumber,
      },
    });

    console.log(`Created endpoint for ${user.id}`);
  }

  console.log("Backfill complete");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });