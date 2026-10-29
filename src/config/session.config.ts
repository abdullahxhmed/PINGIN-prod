import { UserRole } from "@prisma/client";

/**
 * Session Lifecycle and Token Expiry Policy Configuration
 *
 * Rules:
 * 1. Access Token: 15-minute short-lived JWT.
 * 2. Customer (USER) Session:
 *    - 30-day inactivity limit (sliding idle timeout on refresh/activity).
 *    - 90-day absolute limit (fixed ceiling from session creation).
 * 3. Admin (ADMIN) Session:
 *    - 12-hour policy enforced on the backend.
 *    - 12-hour inactivity limit.
 *    - 12-hour absolute limit from initial login.
 *    - Hard cutoff: cannot be extended past 12 hours under any circumstances.
 */
export const SESSION_CONFIG = {
  ACCESS_TOKEN: {
    EXPIRES_IN: "15m",
    EXPIRES_IN_MS: 15 * 60 * 1000, // 15 minutes
  },

  CUSTOMER: {
    INACTIVITY_LIMIT_MS: 30 * 24 * 60 * 60 * 1000, // 30 days
    ABSOLUTE_LIMIT_MS: 90 * 24 * 60 * 60 * 1000,   // 90 days
  },

  ADMIN: {
    INACTIVITY_LIMIT_MS: 12 * 60 * 60 * 1000,      // 12 hours
    ABSOLUTE_LIMIT_MS: 12 * 60 * 60 * 1000,        // 12 hours
  },
} as const;

export interface SessionPolicy {
  INACTIVITY_LIMIT_MS: number;
  ABSOLUTE_LIMIT_MS: number;
}

export const getSessionPolicy = (role?: UserRole | string | null): SessionPolicy => {
  if (role === UserRole.ADMIN || role === "ADMIN") {
    return SESSION_CONFIG.ADMIN;
  }
  return SESSION_CONFIG.CUSTOMER;
};

