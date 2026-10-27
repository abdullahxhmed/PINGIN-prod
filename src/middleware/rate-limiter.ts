import { rateLimit } from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import type { Request } from "express";
import jwt from "jsonwebtoken";
import redis from "../lib/redis.js";

export function getClientIp(req: Request): string {
  const cfIp = req.headers?.["cf-connecting-ip"];
  if (typeof cfIp === "string" && cfIp.trim()) {
    return cfIp.trim().replace(/^::ffff:/, "");
  }

  const forwarded = req.headers?.["x-forwarded-for"];
  let rawIp = "";
  if (typeof forwarded === "string") {
    rawIp = forwarded.split(",")[0]?.trim() || "";
  } else if (Array.isArray(forwarded) && forwarded[0]) {
    rawIp = forwarded[0].split(",")[0]?.trim() || "";
  } else {
    rawIp = req.ip || req.socket?.remoteAddress || "unknown-ip";
  }

  return rawIp.replace(/^::ffff:/, "");
}

export function getClientIdentifier(req: Request): string {
  // 1. If req.user is already populated by upstream middleware
  if (req.user?.id) {
    return `user:${req.user.id}`;
  }

  // 2. If Authorization Bearer token is provided, extract user ID from JWT
  const authHeader = req.headers?.authorization;
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    if (token && process.env.JWT_SECRET) {
      try {
        const payload = jwt.verify(token, process.env.JWT_SECRET) as any;
        if (payload && typeof payload.sub === "string") {
          if (!req.user) {
            req.user = { id: payload.sub };
          }
          return `user:${payload.sub}`;
        }
      } catch {
        // Expired or invalid token, fall back to IP
      }
    }
  }

  // 3. Fallback to client IP
  return `ip:${getClientIp(req)}`;
}

export const apiRateLimiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
  limit: Number(process.env.RATE_LIMIT_MAX) || 1000,                    // 1000 requests per 15 min

  standardHeaders: "draft-8",
  legacyHeaders: false,

  passOnStoreError: true,

  validate: {
    trustProxy: false,
    xForwardedForHeader: false,
  },

  skip: (req) => {
    const reqUrl = req.originalUrl || req.url || req.path || "";

    // Webhooks authenticate via HMAC signatures; do not throttle external provider callbacks
    if (reqUrl.startsWith("/api/webhooks")) return true;

    // Skip health checks
    if (reqUrl === "/health" || reqUrl === "/api/health") return true;

    // Skip server-to-server or operator requests with valid admin key
    const adminKey = req.headers?.["x-admin-key"];
    const configuredAdminKey = process.env.ADMIN_KEY;
    if (
      configuredAdminKey &&
      typeof adminKey === "string" &&
      adminKey.trim() === configuredAdminKey
    ) {
      return true;
    }

    // In non-production, respect RATE_LIMIT_ENABLED="false"
    if (process.env.NODE_ENV !== "production" && process.env.RATE_LIMIT_ENABLED === "false") {
      return true;
    }

    return false;
  },

  keyGenerator: (req) => getClientIdentifier(req),

  store: new RedisStore({
    prefix: "rl:api:",
    sendCommand: (...args: string[]) =>
      redis.call(args[0]!, ...args.slice(1)) as any,
  }),

  message: {
    status: 429,
    message: "Too many requests. Please try again later.",
  },
});