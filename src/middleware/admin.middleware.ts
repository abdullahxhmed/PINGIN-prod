import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { ForbiddenError, UnauthorizedError } from "../errors/AppError.js";
import { prisma } from "../lib/prisma.js";
import { UserRole } from "@prisma/client";

/**
 * Middleware that enforces admin-only access.
 *
 * Auth paths (checked in order):
 * 1. "x-admin-key" header matching ADMIN_KEY env var  → bypasses DB, for server-to-server use.
 * 2. "Authorization: Bearer <jwt>" where the JWT sub resolves to a User with role = ADMIN.
 *
 * On success:  populates req.user = { id, role } and calls next().
 * On failure:  throws ForbiddenError (→ 403).
 */
export const requireAdmin = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  // ── Path 1: static server-side admin key (server-to-server / CI jobs) ──
  const adminKey = req.headers["x-admin-key"];
  const configuredAdminKey = process.env.ADMIN_KEY;

  if (configuredAdminKey && adminKey === configuredAdminKey) {
    // Attach a synthetic user so downstream code can safely read req.user
    req.user = { id: "admin-key", role: UserRole.ADMIN };
    return next();
  }

  // ── Path 2: Bearer JWT → DB role check ──
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new ForbiddenError("Administrative privilege required for this action.");
  }

  const token = authHeader.slice(7);
  let payload: any;

  try {
    payload = jwt.verify(token, process.env.JWT_SECRET!);
  } catch (err: any) {
    if (err?.name === "TokenExpiredError") {
      throw new UnauthorizedError("jwt expired");
    }
    throw new ForbiddenError("Administrative privilege required for this action.");
  }

  if (!payload || typeof payload.sub !== "string") {
    throw new ForbiddenError("Administrative privilege required for this action.");
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.sub, active: true },
    select: { role: true },
  });

  if (!user || user.role !== UserRole.ADMIN) {
    throw new ForbiddenError("Administrative privilege required for this action.");
  }

  req.user = { id: payload.sub, role: UserRole.ADMIN };
  return next();
};
