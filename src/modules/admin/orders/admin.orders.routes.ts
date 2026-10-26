import { Router } from "express";
import {
  adminListOrdersController,
  adminGetOrderByIdController,
  adminUpdateOrderStatusController,
  adminOrderMetricsController,
} from "./admin.orders.controllers.js";

import adminPackingRoutes from "../packing/admin.packing.routes.js";

const adminOrderRoutes = Router();

// Warehouse Pick-to-Scan Packing Sub-routes
adminOrderRoutes.use("/:orderId/packing", adminPackingRoutes);

// Order metrics & KPIs
adminOrderRoutes.get("/metrics", adminOrderMetricsController);

// List orders with pagination & filters
adminOrderRoutes.get("/", adminListOrdersController);

// Detailed view of an order
adminOrderRoutes.get("/:orderId", adminGetOrderByIdController);

// Update order status (advance fulfillment)
adminOrderRoutes.patch("/:orderId/status", adminUpdateOrderStatusController);

export default adminOrderRoutes;
