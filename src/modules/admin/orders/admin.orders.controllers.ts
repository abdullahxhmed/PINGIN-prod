import type { Request, Response } from "express";
import asyncHandler from "express-async-handler";
import { OrderStatus } from "@prisma/client";
import {
  adminListOrders,
  adminGetOrderById,
  adminUpdateOrderStatus,
  adminGetOrderMetrics,
} from "./admin.orders.services.js";
import { BadRequestError } from "../../../errors/AppError.js";

/**
 * GET /api/admin/orders
 */
export const adminListOrdersController = asyncHandler(async (req: Request, res: Response) => {
  const page = req.query.page ? parseInt(String(req.query.page), 10) : 1;
  const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 20;
  const status = req.query.status ? (String(req.query.status) as OrderStatus) : undefined;
  const search = req.query.search ? String(req.query.search).trim() : undefined;
  const startDate = req.query.startDate ? new Date(String(req.query.startDate)) : undefined;
  const endDate = req.query.endDate ? new Date(String(req.query.endDate)) : undefined;

  const result = await adminListOrders({
    page,
    limit,
    status,
    search,
    startDate,
    endDate,
  });

  res.status(200).json({
    status: "success",
    data: result,
  });
});

/**
 * GET /api/admin/orders/metrics
 */
export const adminOrderMetricsController = asyncHandler(async (_req: Request, res: Response) => {
  const metrics = await adminGetOrderMetrics();
  res.status(200).json({
    status: "success",
    data: metrics,
  });
});

/**
 * GET /api/admin/orders/:orderId
 */
export const adminGetOrderByIdController = asyncHandler(async (req: Request, res: Response) => {
  const { orderId } = req.params;
  if (!orderId || Array.isArray(orderId)) {
    throw new BadRequestError("Valid orderId parameter is required");
  }

  const order = await adminGetOrderById(orderId);
  res.status(200).json({
    status: "success",
    data: order,
  });
});

/**
 * PATCH /api/admin/orders/:orderId/status
 */
export const adminUpdateOrderStatusController = asyncHandler(async (req: Request, res: Response) => {
  const { orderId } = req.params;
  const { status } = req.body;

  if (!orderId || Array.isArray(orderId)) {
    throw new BadRequestError("Valid orderId parameter is required");
  }

  if (!status || !Object.values(OrderStatus).includes(status)) {
    throw new BadRequestError(`Invalid or missing status. Valid values: ${Object.values(OrderStatus).join(", ")}`);
  }

  const updated = await adminUpdateOrderStatus(orderId, status as OrderStatus);
  res.status(200).json({
    status: "success",
    data: updated,
  });
});
