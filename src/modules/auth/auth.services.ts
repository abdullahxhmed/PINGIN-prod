import { prisma } from "../../lib/prisma.js";
import dotenv from "dotenv";
import { getUserSubscription } from "../subscriptions/subscriptions.services.js";
import { decryptPhoneNumber } from "../../utils/data-protection.js";
import {
  createAccessToken,
  createSession,
  refreshSession,
  revokeSession,
  revokeSessionByToken,
  revokeAllUserSessions,
  validateBackendSession,
  hasActiveAdminSession,
  touchSessionActivity,
} from "./session.service.js";

dotenv.config();

const getCurrentUser = async (userId: string) => {
    const user = await prisma.user.findUnique({
        where: {
            id: userId,
            active: true
        },
        select: {
            id: true,
            name: true,
            mobileNumber: true,
            role: true,
            contactEndpoint: {
                select: {
                    type: true,
                    phoneNumber: true,
                },
            },
        },
    });

    if (!user) return null;

    const subData = await getUserSubscription(userId);

    return {
        ...user,
        mobileNumber: decryptPhoneNumber(user.mobileNumber),
        contactEndpoint: user.contactEndpoint
            ? {
                ...user.contactEndpoint,
                phoneNumber: decryptPhoneNumber(user.contactEndpoint.phoneNumber),
            }
            : null,
        subscription: subData.subscription,
        tagQuota: {
            activeCount: subData.tags.activeCount,
            suspendedCount: subData.tags.suspendedCount,
            maxLimit: subData.subscription.maxActiveTags,
            needsTagSelection: subData.tags.needsTagSelection,
        },
    };
};

export {
    createAccessToken,
    createSession,
    refreshSession,
    revokeSession,
    revokeSessionByToken,
    revokeAllUserSessions,
    validateBackendSession,
    hasActiveAdminSession,
    touchSessionActivity,
    getCurrentUser
};