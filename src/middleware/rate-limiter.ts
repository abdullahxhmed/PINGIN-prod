import { rateLimit } from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import type { Request } from "express";
import redis from "../lib/redis.js";

function getClientIp(req: Request): string {
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

export const apiRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 1000,              // 1000 requests per 15 minutes (~66 req/min)

  standardHeaders: "draft-8",
  legacyHeaders: false,

  validate: {
    trustProxy: false,
    xForwardedForHeader: false,
  },

  skip: (req) => {
    // Dynamically evaluate env var so runtime changes or late dotenv loading take effect
    if (process.env.RATE_LIMIT_ENABLED !== "true") return true;

    // Skip health checks
    if (req.path === "/health" || req.path === "/api/health") return true;

    return false;
  },

  keyGenerator: (req) => getClientIp(req),

  store: new RedisStore({
    prefix: "rl:api:",
    sendCommand: (...args: string[]) =>
      redis.call(args[0]!, ...args.slice(1)) as any,
  }),

  message: {
    message: "Too many requests. Please try again later.",
  },
});