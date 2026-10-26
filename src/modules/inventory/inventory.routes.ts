import { Router } from "express";
import { optionalAuthenticateRequest } from "../auth/auth.middleware.js";
import {
  checkAvailabilityController,
  createReservationController,
  getReservationController,
  releaseReservationController,
} from "./inventory.controllers.js";

const router = Router();

router.post("/availability", checkAvailabilityController);
router.post("/reserve", optionalAuthenticateRequest, createReservationController);
router.get("/reservation/:checkoutSessionId", getReservationController);
router.post("/reservation/:reservationId/release", releaseReservationController);

export default router;
