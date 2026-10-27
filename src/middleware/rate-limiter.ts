import { rateLimit } from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import type { Request } from "express";
import jwt from "jsonwebtoken";
import redis from "../lib/redis.js";

export function getClientIp(req: Request): string {
  const cfIp = req.headers?.["cf-connecting-ip"];
  if (typeof cfIp === "string" && cfIp.trim()) return cfIp.trim();

  const forwarded = req.headers?.["x-forwarded-for"];
  if (typeof forwarded === "string") {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  } else if (Array.isArray(forwarded) && forwarded[0]) {
    const first = forwarded[0].split(",")[0]?.trim();
    if (first) return first;
  }

  return req.ip || req.socket?.remoteAddress || "unknown-ip";
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
          // Pre-populate req.user so downstream middleware can also benefit
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
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 1000,              // 1000 requests per 15 minutes (~66 req/min)

  standardHeaders: "draft-8",
  legacyHeaders: false,

  passOnStoreError: true,

  validate: {
    trustProxy: false,
    xForwardedForHeader: false,
  },

  skip: (req) => {
    // Dynamically evaluate env var so runtime changes or late dotenv loading take effect
    if (process.env.RATE_LIMIT_ENABLED !== "true") return true;

    // Skip health checks
    if (req.path === "/health" || req.path === "/api/health") return true;

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

    return false;
  },

  keyGenerator: (req) => getClientIdentifier(req),

  store: new RedisStore({
    prefix: "rl:api:",
    sendCommand: (...args: string[]) =>
      redis.call(args[0]!, ...args.slice(1)) as any,
  }),

  message: {
    message: "Too many requests. Please try again later.",
  },
});