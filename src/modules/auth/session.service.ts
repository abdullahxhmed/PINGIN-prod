import crypto from "crypto";
import jwt from "jsonwebtoken";
import { UserRole } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import redis from "../../lib/redis.js";
import { BadRequestError, UnauthorizedError } from "../../errors/AppError.js";
import { SESSION_CONFIG, getSessionPolicy } from "../../config/session.config.js";

export interface SessionResult {
  rawToken: string;
  sessionId: string;
  expiresAt: Date;
  absoluteExpiresAt: Date;
}

/**
 * Creates a signed 15-minute access token embedding user ID, role, and backing session ID.
 */
export const createAccessToken = (
  userId: string,
  role?: string,
  sessionId?: string
): string => {
  const payload: Record<string, unknown> = { sub: userId };
  if (role) payload.role = role;
  if (sessionId) payload.sid = sessionId;

  return jwt.sign(payload, process.env.JWT_SECRET!, {
    expiresIn: SESSION_CONFIG.ACCESS_TOKEN.EXPIRES_IN,
  });
};

/**
 * Creates a new refresh session enforcing role-based inactivity and absolute limits.
 * Customer: 30-day inactivity limit, 90-day absolute ceiling.
 * Admin: 12-hour session policy (both inactivity and absolute limit).
 */
export const createSession = async (
  userId: string,
  userRole?: UserRole
): Promise<SessionResult> => {
  let role = userRole;
  if (!role) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    role = user?.role ?? UserRole.USER;
  }

  const policy = getSessionPolicy(role);
  const now = new Date();

  const rawToken = crypto.randomBytes(32).toString("base64url");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

  const expiresAt = new Date(now.getTime() + policy.INACTIVITY_LIMIT_MS);
  const absoluteExpiresAt = new Date(now.getTime() + policy.ABSOLUTE_LIMIT_MS);

  try {
    const session = await prisma.refreshToken.create({
      data: {
        userId,
        tokenHash,
        expiresAt,
        absoluteExpiresAt,
        lastUsedAt: now,
        revokedAt: null,
      },
    });

    // Cache session in Redis for sub-millisecond middleware validation
    try {
      const ttlSeconds = Math.max(60, Math.ceil(policy.ABSOLUTE_LIMIT_MS / 1000));
      await redis.set(
        `session:${session.id}`,
        JSON.stringify({
          id: session.id,
          userId,
          role,
          absoluteExpiresAt: absoluteExpiresAt.toISOString(),
          lastUsedAt: now.toISOString(),
          revoked: false,
        }),
        "EX",
        ttlSeconds
      );
    } catch {
      // Redis is non-blocking; DB is primary source of truth
    }

    return {
      rawToken,
      sessionId: session.id,
      expiresAt,
      absoluteExpiresAt,
    };
  } catch (err: any) {
    throw new BadRequestError(`Failed to create session: ${err.message}`);
  }
};

/**
 * Validates and rotates an existing refresh session.
 * Enforces both the inactivity limit and the absolute ceiling on the backend.
 */
export const refreshSession = async (
  refreshToken: string
): Promise<{ accessToken: string; refreshToken: string; cookieExpiresAt: Date }> => {
  const hashedToken = crypto.createHash("sha256").update(refreshToken).digest("hex");

  const token = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashedToken },
    include: {
      user: {
        select: {
          id: true,
          role: true,
          active: true,
        },
      },
    },
  });

  const now = new Date();

  if (!token || !token.user || !token.user.active || token.revokedAt) {
    throw new UnauthorizedError("Invalid or revoked refresh token");
  }

  const role = token.user.role;
  const policy = getSessionPolicy(role);

  // 1. Enforce Absolute Limit on the backend (cannot be bypassed by continuous refresh)
  const absoluteLimit =
    token.absoluteExpiresAt ??
    new Date(token.createdAt.getTime() + policy.ABSOLUTE_LIMIT_MS);

  if (now > absoluteLimit) {
    await revokeSession(token.id);
    throw new UnauthorizedError(
      role === UserRole.ADMIN
        ? "Admin session has expired (12-hour maximum duration reached). Please sign in again."
        : "Session has expired (maximum session duration reached). Please sign in again."
    );
  }

  // 2. Enforce Inactivity Limit on the backend (idle timeout)
  const lastActive = token.lastUsedAt ?? token.createdAt;
  const idleMs = now.getTime() - lastActive.getTime();

  if (idleMs > policy.INACTIVITY_LIMIT_MS || now > token.expiresAt) {
    await revokeSession(token.id);
    throw new UnauthorizedError(
      role === UserRole.ADMIN
        ? "Admin session expired due to inactivity (12-hour limit). Please sign in again."
        : "Session expired due to inactivity (30-day limit). Please sign in again."
    );
  }

  // 3. Rotate refresh token and slide inactivity window (capped by absolute ceiling)
  const newRawToken = crypto.randomBytes(32).toString("base64url");
  const newTokenHash = crypto.createHash("sha256").update(newRawToken).digest("hex");

  const newExpiresAt = new Date(
    Math.min(now.getTime() + policy.INACTIVITY_LIMIT_MS, absoluteLimit.getTime())
  );

  await prisma.refreshToken.update({
    where: { id: token.id },
    data: {
      tokenHash: newTokenHash,
      lastUsedAt: now,
      expiresAt: newExpiresAt,
    },
  });

  // Update Redis session cache
  try {
    const remainingSec = Math.max(60, Math.ceil((absoluteLimit.getTime() - now.getTime()) / 1000));
    await redis.set(
      `session:${token.id}`,
      JSON.stringify({
        id: token.id,
        userId: token.user.id,
        role: token.user.role,
        absoluteExpiresAt: absoluteLimit.toISOString(),
        lastUsedAt: now.toISOString(),
        revoked: false,
      }),
      "EX",
      remainingSec
    );
  } catch {
    // Non-blocking
  }

  // 4. Issue fresh 15-minute access token linked to the session
  const accessToken = createAccessToken(token.userId, token.user.role, token.id);

  return {
    accessToken,
    refreshToken: newRawToken,
    cookieExpiresAt: newExpiresAt,
  };
};

/**
 * Validates session state on the backend against inactivity and absolute limits.
 * Used by authentication middleware to reject revoked or expired sessions immediately.
 */
export const validateBackendSession = async (
  sessionId: string,
  requiredRole?: UserRole
): Promise<{ valid: boolean; reason?: string; user?: { id: string; role: UserRole } }> => {
  const now = new Date();

  // Fast path: Redis cache
  try {
    const cached = await redis.get(`session:${sessionId}`);
    if (cached) {
      const data = JSON.parse(cached);
      if (data.revoked) {
        return { valid: false, reason: "Session has been revoked" };
      }

      const absoluteExpiry = new Date(data.absoluteExpiresAt);
      if (now > absoluteExpiry) {
        return { valid: false, reason: "Session absolute duration limit reached" };
      }

      const policy = getSessionPolicy(data.role);
      const lastActive = new Date(data.lastUsedAt);
      if (now.getTime() - lastActive.getTime() > policy.INACTIVITY_LIMIT_MS) {
        return { valid: false, reason: "Session expired due to inactivity" };
      }

      if (requiredRole && data.role !== requiredRole) {
        return { valid: false, reason: "Role does not match required role" };
      }

      return { valid: true, user: { id: data.userId, role: data.role } };
    }
  } catch {
    // Fall back to database
  }

  // Slow path: Database lookup
  const token = await prisma.refreshToken.findUnique({
    where: { id: sessionId },
    include: {
      user: {
        select: {
          id: true,
          role: true,
          active: true,
        },
      },
    },
  });

  if (!token || !token.user || !token.user.active || token.revokedAt) {
    return { valid: false, reason: "Session invalid or revoked" };
  }

  const role = token.user.role;
  const policy = getSessionPolicy(role);

  const absoluteLimit =
    token.absoluteExpiresAt ??
    new Date(token.createdAt.getTime() + policy.ABSOLUTE_LIMIT_MS);

  if (now > absoluteLimit) {
    await revokeSession(token.id);
    return { valid: false, reason: "Session absolute duration limit reached" };
  }

  const lastActive = token.lastUsedAt ?? token.createdAt;
  if (
    now.getTime() - lastActive.getTime() > policy.INACTIVITY_LIMIT_MS ||
    now > token.expiresAt
  ) {
    await revokeSession(token.id);
    return { valid: false, reason: "Session expired due to inactivity" };
  }

  if (requiredRole && role !== requiredRole) {
    return { valid: false, reason: "Role does not match required role" };
  }

  // Re-populate Redis cache
  try {
    const ttlSeconds = Math.max(60, Math.ceil((absoluteLimit.getTime() - now.getTime()) / 1000));
    await redis.set(
      `session:${token.id}`,
      JSON.stringify({
        id: token.id,
        userId: token.user.id,
        role: token.user.role,
        absoluteExpiresAt: absoluteLimit.toISOString(),
        lastUsedAt: lastActive.toISOString(),
        revoked: false,
      }),
      "EX",
      ttlSeconds
    );
  } catch {
    // Non-blocking
  }

  return { valid: true, user: { id: token.user.id, role: token.user.role } };
};

/**
 * Throttled activity timestamp updater.
 * Updates lastUsedAt at most once every 5 minutes per session.
 */
export const touchSessionActivity = async (sessionId: string): Promise<void> => {
  try {
    const touchKey = `session:touch:${sessionId}`;
    const isFirstInWindow = await redis.set(touchKey, "1", "EX", 300, "NX");
    if (isFirstInWindow) {
      const now = new Date();
      await prisma.refreshToken.update({
        where: { id: sessionId },
        data: { lastUsedAt: now },
      });

      // Update Redis session cache
      const cached = await redis.get(`session:${sessionId}`);
      if (cached) {
        const data = JSON.parse(cached);
        data.lastUsedAt = now.toISOString();
        const ttl = await redis.ttl(`session:${sessionId}`);
        if (ttl > 0) {
          await redis.set(`session:${sessionId}`, JSON.stringify(data), "EX", ttl);
        }
      }
    }
  } catch {
    // Non-blocking
  }
};

/**
 * Checks whether an admin user has an active, unexpired, unrevoked session within the 12-hour limit.
 * Used for backward compatibility when a token does not contain a session ID (sid).
 */
export const hasActiveAdminSession = async (userId: string): Promise<boolean> => {
  const now = new Date();
  const policy = SESSION_CONFIG.ADMIN;
  const minCreatedAt = new Date(now.getTime() - policy.ABSOLUTE_LIMIT_MS);

  const activeSession = await prisma.refreshToken.findFirst({
    where: {
      userId,
      revokedAt: null,
      createdAt: { gte: minCreatedAt },
      expiresAt: { gt: now },
    },
    orderBy: { createdAt: "desc" },
  });

  return Boolean(activeSession);
};

/**
 * Revokes a session by ID immediately on the backend and in Redis.
 */
export const revokeSession = async (sessionId: string): Promise<void> => {
  await prisma.refreshToken.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  try {
    const cached = await redis.get(`session:${sessionId}`);
    if (cached) {
      const data = JSON.parse(cached);
      data.revoked = true;
      await redis.set(`session:${sessionId}`, JSON.stringify(data), "EX", 3600);
    } else {
      await redis.del(`session:${sessionId}`);
    }
  } catch {
    // Non-blocking
  }
};

/**
 * Revokes a session by raw refresh token string.
 */
export const revokeSessionByToken = async (refreshToken: string): Promise<boolean> => {
  const tokenHash = crypto.createHash("sha256").update(refreshToken).digest("hex");
  const token = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    select: { id: true },
  });

  if (!token) return false;
  await revokeSession(token.id);
  return true;
};

/**
 * Revokes all active sessions for a user (e.g. on password change).
 */
export const revokeAllUserSessions = async (userId: string): Promise<void> => {
  const sessions = await prisma.refreshToken.findMany({
    where: { userId, revokedAt: null },
    select: { id: true },
  });

  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  for (const s of sessions) {
    try {
      await redis.del(`session:${s.id}`);
    } catch {}
  }
};

