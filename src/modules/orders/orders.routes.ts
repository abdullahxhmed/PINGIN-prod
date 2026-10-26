import { Router } from "express";
import { optionalAuthenticateRequest } from "../auth/auth.middleware.js";
import {
  checkoutOrderController,
  getOrderStatusController,
  trackOrderPubliclyController,
} from "./orders.controllers.js";
import claimsRouter from "../claims/claims.routes.js";

const orderRouter = Router();

// Guest-first checkout (associates with user if authenticated)
orderRouter.post("/checkout", optionalAuthenticateRequest, checkoutOrderController);

// Purchase claims (OTP verification to associate guest order with account)
orderRouter.use("/claims", claimsRouter);

// Public / client payment and order status recovery
orderRouter.get("/:orderNumber/status", getOrderStatusController);

// Dedicated public tracking endpoints (by orderNumber or courier AWB code)
orderRouter.get("/:orderNumber/track", trackOrderPubliclyController);
orderRouter.get("/track/:identifier", trackOrderPubliclyController);

export default orderRouter;

