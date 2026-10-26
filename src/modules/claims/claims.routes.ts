import { Router } from "express";
import { authenticateRequest } from "../auth/auth.middleware.js";
import {
  requestClaimOtpController,
  verifyClaimOtpController,
} from "./claims.controllers.js";

const claimsRouter = Router();

claimsRouter.post("/request-otp", authenticateRequest, requestClaimOtpController);
claimsRouter.post("/verify", authenticateRequest, verifyClaimOtpController);

export default claimsRouter;
