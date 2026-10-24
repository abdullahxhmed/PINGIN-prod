import { prisma } from "../lib/prisma.js";
import {
  getUserSubscription,
  createPackPurchase,
  activatePackPurchase,
  selectActiveTags,
} from "../modules/subscriptions/subscriptions.services.js";
import { PurchasePackType, SubscriptionTier, QrTagStatus, QrTagOrigin, ResourceType } from "@prisma/client";

async function runTests() {
  console.log("--- Starting Subscription Flow Verification ---");

  // 1. Create a dummy test user
  const randomSuffix = Math.floor(100000 + Math.random() * 900000);
  const testMobile = `+919999${randomSuffix}`;
  const user = await prisma.user.create({
    data: {
      name: `Test Sub User ${randomSuffix}`,
      mobileNumber: testMobile,
    },
  });
  console.log(`✓ Created test user: ${user.id} (${user.mobileNumber})`);

  try {
    // 2. Fetch default subscription
    const initialSub = await getUserSubscription(user.id);
    console.log(`✓ Default tier: ${initialSub.subscription.tier}, Max tags: ${initialSub.subscription.maxActiveTags}, Analytics: ${initialSub.subscription.hasAnalytics}`);
    if (initialSub.subscription.tier !== SubscriptionTier.BASIC || initialSub.subscription.maxActiveTags !== 2) {
      throw new Error("Default subscription should be BASIC with 2 tags max");
    }

    // 3. Purchase & activate 499 Pack (4 tags + 12-month Plus subscription)
    const { purchase } = await createPackPurchase(user.id, PurchasePackType.PACK_499, "MANUAL");
    console.log(`✓ Created pending 499 pack purchase: ${purchase.id}, amountPaise: ${purchase.amountPaise} (₹${purchase.amountPaise / 100})`);

    const activated = await activatePackPurchase(user.id, { purchaseId: purchase.id });
    console.log(`✓ Activated 499 pack: ${activated.message}`);
    console.log(`  New Tier: ${activated.subscription.tier}, Max tags: ${activated.subscription.maxActiveTags}, Expires: ${activated.subscription.expiresAt?.toISOString()}`);
    if (activated.subscription.tier !== SubscriptionTier.PLUS || activated.subscription.maxActiveTags !== 8) {
      throw new Error("Activated subscription should be PLUS with 8 tags max");
    }

    // 4. Create 3 resources with paired tags for this user
    const tagIds: string[] = [];
    for (let i = 1; i <= 3; i++) {
      const resource = await prisma.resource.create({
        data: {
          userId: user.id,
          name: `Vehicle ${i}`,
          type: ResourceType.VEHICLE,
        },
      });

      const tagNumber = `TEST${randomSuffix.toString().slice(0, 3)}${i}`;
      const tag = await prisma.qrTag.create({
        data: {
          tagNumber,
          tokenHash: `hash_${randomSuffix}_${i}`,
          origin: QrTagOrigin.PREPRINTED_INVENTORY,
          status: QrTagStatus.ASSIGNED,
          resourceId: resource.id,
          assignedAt: new Date(),
        },
      });
      tagIds.push(tag.id);
    }
    console.log(`✓ Created 3 resources with paired tags for user: ${tagIds.join(", ")}`);

    // 5. Test Expiration & Demotion Simulation
    console.log("Simulating Plus subscription expiration...");
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await prisma.subscription.update({
      where: { userId: user.id },
      data: { expiresAt: yesterday },
    });

    const expiredCheck = await getUserSubscription(user.id);
    console.log(`✓ After expiry check: Tier is now ${expiredCheck.subscription.tier}, needsTagSelection: ${expiredCheck.tags.needsTagSelection}`);
    if (expiredCheck.subscription.tier !== SubscriptionTier.BASIC) {
      throw new Error("Expired subscription must be demoted to BASIC");
    }
    if (!expiredCheck.tags.needsTagSelection) {
      throw new Error("User has 3 tags, so needsTagSelection must be true upon demotion to BASIC (max 2)");
    }

    // 6. Test selectActiveTags (Prompting user to choose 2 active tags)
    console.log("Testing tag selection (keeping first 2 tags active, suspending the 3rd)...");
    const chosenTwo = tagIds.slice(0, 2);
    const updatedTagsResult = await selectActiveTags(user.id, chosenTwo);
    console.log(`✓ After tag selection: Active tags: ${updatedTagsResult.tags.activeCount}, Suspended tags: ${updatedTagsResult.tags.suspendedCount}, needsTagSelection: ${updatedTagsResult.tags.needsTagSelection}`);
    if (updatedTagsResult.tags.activeCount !== 2 || updatedTagsResult.tags.suspendedCount !== 1) {
      throw new Error("Expected exactly 2 active tags and 1 suspended tag");
    }

    // 7. Test 179 Pack Activation (1 tag + 12-month Plus subscription)
    console.log("Activating 179 pack (1 tag + 12-month Plus combo)...");
    const reActivation = await activatePackPurchase(user.id, { packType: PurchasePackType.PACK_179 });
    console.log(`✓ Re-activated via 179 pack: Tier is ${reActivation.subscription.tier}, Max tags: ${reActivation.subscription.maxActiveTags}`);

    // Verify suspended tag was automatically re-activated
    const postReactivate = await getUserSubscription(user.id);
    console.log(`✓ Post re-activation: Active tags: ${postReactivate.tags.activeCount}, Suspended tags: ${postReactivate.tags.suspendedCount}`);
    if (postReactivate.tags.activeCount !== 3 || postReactivate.tags.suspendedCount !== 0) {
      throw new Error("Previously suspended tag should be automatically restored to ASSIGNED");
    }

    console.log("--- All subscription models, packaging, and lifecycle tests passed successfully! ---");
  } finally {
    // Cleanup test user and data
    await prisma.qrAssignment.deleteMany({
      where: { resource: { userId: user.id } },
    });
    await prisma.qrTag.deleteMany({
      where: { resource: { userId: user.id } },
    });
    await prisma.resource.deleteMany({
      where: { userId: user.id },
    });
    await prisma.subscriptionPurchase.deleteMany({
      where: { userId: user.id },
    });
    await prisma.subscription.deleteMany({
      where: { userId: user.id },
    });
    await prisma.user.delete({
      where: { id: user.id },
    });
    console.log(`✓ Cleaned up test data for user ${user.id}`);
  }
}

runTests().catch((err) => {
  console.error("Test error:", err);
  process.exit(1);
});
