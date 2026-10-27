import { Router } from "express";
import { optionalAuthenticateRequest } from "../auth/auth.middleware.js";
import {
  checkoutOrderController,
  getOrderStatusController,
  trackOrderPubliclyController,
  verifyPaymentController,
} from "./orders.controllers.js";
import claimsRouter from "../claims/claims.routes.js";

const orderRouter = Router();

// Guest-first checkout (associates with user if authenticated)
orderRouter.post("/checkout", optionalAuthenticateRequest, checkoutOrderController);

// Direct client cryptographic payment verification (<200ms instant redirect)
orderRouter.post("/verify-payment", optionalAuthenticateRequest, verifyPaymentController);

// Purchase claims (OTP verification to associate guest order with account)
orderRouter.use("/claims", claimsRouter);

// Public / client payment and order status recovery
orderRouter.get("/:orderNumber/status", getOrderStatusController);

// Dedicated public tracking endpoints (by orderNumber or courier AWB code)
orderRouter.get("/:orderNumber/track", trackOrderPubliclyController);
orderRouter.get("/track/:identifier", trackOrderPubliclyController);

export default orderRouter;

