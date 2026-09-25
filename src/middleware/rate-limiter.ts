import { rateLimit } from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import redis from "../lib/redis.js";
import config from "dotenv"

const rateLimiterEnabled = process.env.RATE_LIMIT_ENABLED === "true";
console.log("RATE LIMIT ENABLED:", rateLimiterEnabled);

export const apiRateLimiter = rateLimit({
  windowMs: 15* 60 * 1000,
  limit: 50,

  standardHeaders: "draft-8",
  legacyHeaders: false,

  skip: () => !rateLimiterEnabled,

  store: new RedisStore({
    sendCommand: (...args: string[]) =>
      redis.call(args[0]!, ...args.slice(1)) as any,
  }),

  message: {
    message: "Too many requests. Please try again later.",
  },
});