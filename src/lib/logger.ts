import crypto from "node:crypto";
import pino from "pino";
import { pinoHttp } from "pino-http";

const isProduction = process.env.NODE_ENV === "production";
const logLevel = process.env.LOG_LEVEL || (isProduction ? "info" : "debug");

const redactPaths = [
  "req.headers.authorization",
  "req.headers.cookie",
  'req.headers["x-api-key"]',
  "req.body.password",
  "req.body.token",
  "req.body.otp",
  "req.body.secret",
  "req.body.razorpaySignature",
  "req.body.razorpay_signature",
  "password",
  "token",
  "otp",
  "secret",
];

function getClientIp(req: any): string {
  const forwarded = req.headers?.["x-forwarded-for"];
  if (typeof forwarded === "string") {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers?.["cf-connecting-ip"] || req.socket?.remoteAddress || "";
}

export const logger = pino({
  level: logLevel,
  redact: {
    paths: redactPaths,
    censor: "[REDACTED]",
  },
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "HH:MM:ss.l",
            ignore: "pid,hostname,req,res,responseTime",
            singleLine: true,
          },
        },
      }),
});

export const httpLogger = pinoHttp({
  logger,
  quietReqLogger: !isProduction,
  quietResLogger: !isProduction,
  customSuccessObject: (req: any) => {
    const reqUrl = req.originalUrl || req.url || "";
    const pathname = reqUrl.split("?")[0] || "";
    const isApiOrPublic =
      pathname.startsWith("/api") ||
      pathname.startsWith("/t/") ||
      pathname.startsWith("/qr/") ||
      pathname === "/favicon.ico" ||
      pathname === "/robots.txt";

    const extra: Record<string, any> = {};
    if (!isApiOrPublic) {
      extra.diagnostic = "UNEXPECTED_NON_API_ROUTE";
      extra.requestedPath = pathname;
      extra.fullUrl = reqUrl;
      if (req.headers?.referer) extra.referer = req.headers.referer;
    }

    const hasQuery = req.query && Object.keys(req.query).length > 0;
    if (hasQuery) extra.query = req.query;

    return extra;
  },
  customErrorObject: (_req: any, _res: any, err: Error) => ({
    err: err?.message || String(err),
  }),
  genReqId: (req, res) => {
    const existing = req.headers["x-request-id"] || req.headers["x-correlation-id"];
    const id =
      (typeof existing === "string" ? existing : Array.isArray(existing) ? existing[0] : undefined) ||
      crypto.randomUUID();
    res.setHeader("x-request-id", id);
    return id;
  },
  customLogLevel: (_req, res, err) => {
    if (res.statusCode >= 500 || err) return "error";
    if (res.statusCode >= 400) return "warn";
    // Lower routine successful requests (2xx, 3xx) to debug to prevent log bombardment
    return "debug";
  },
  customSuccessMessage: (req: any, res: any, responseTime: number) => {
    const ip = getClientIp(req);
    const ipPart = ip ? ` [ip: ${ip}]` : "";
    const idPart = req.id ? ` [id: ${String(req.id).slice(0, 8)}]` : "";
    const ms = Math.round(responseTime);
    const reqUrl = req.originalUrl || req.url || "";
    return `${req.method} ${reqUrl} -> ${res.statusCode} (${ms}ms)${ipPart}${idPart}`;
  },
  customErrorMessage: (req: any, res: any, err: Error) => {
    const ip = getClientIp(req);
    const ipPart = ip ? ` [ip: ${ip}]` : "";
    const idPart = req.id ? ` [id: ${String(req.id).slice(0, 8)}]` : "";
    const reqUrl = req.originalUrl || req.url || "";
    return `${req.method} ${reqUrl} -> ${res.statusCode}${ipPart}${idPart} - ${err.message}`;
  },
  autoLogging: {
    ignore: (req) => {
      // Don't spam logs for frequent health checks
      const reqUrl = req.originalUrl || req.url || "";
      return reqUrl === "/api/health" || reqUrl === "/health";
    },
  },
});

export default logger;
