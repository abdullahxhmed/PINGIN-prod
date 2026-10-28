import { Router } from "express";
import { optionalAuthenticateRequest } from "../auth/auth.middleware.js";
import { calculateShippingRatesController } from "./shipping.controllers.js";

const shippingRouter = Router();

// Calculate authoritative shipping rates & courier serviceability for cart
shippingRouter.post("/rates", optionalAuthenticateRequest, calculateShippingRatesController);

export default shippingRouter;

