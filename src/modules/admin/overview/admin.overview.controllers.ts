import type { Request, Response } from "express";
import { z } from "zod";
import asyncHandler from "express-async-handler";
import { BadRequestError } from "../../../errors/AppError.js";
import { getAdminOverview } from "./admin.overview.services.js";
import type { OverviewPeriod } from "./admin.overview.types.js";

const overviewQuerySchema = z.object({
  period: z.enum(["today", "7d", "30d"]).default("7d"),
  includeTest: z
    .enum(["0", "1", "true", "false"])
    .optional()
    .transform((val) => val === "1" || val === "true"),
});

/**
 * @route   GET /api/admin/overview?period=today|7d|30d&includeTest=1
 * @desc    Single consolidated overview endpoint for admin analytics, usage, costs, activation, sales, and fulfilment.
 * @access  Admin
 */
export const adminOverviewController = asyncHandler(async (req: Request, res: Response) => {
  const parsed = overviewQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw new BadRequestError(
      `Invalid query parameters. Period must be 'today', '7d', or '30d'. Got period='${req.query.period}'`
    );
  }

  const overview = await getAdminOverview(
    parsed.data.period as OverviewPeriod,
    Boolean(parsed.data.includeTest)
  );
  res.status(200).json(overview);
});
