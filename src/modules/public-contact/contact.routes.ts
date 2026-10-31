import express from "express";
import {
  getContactController,
  verifyRegNumController,
  recordTagVisitController,
} from "./contact.controllers.js";
import { initiateCallController } from "../communication/communication.controller.js";

const router = express.Router();

router.route("/:token").get(getContactController);

// Call initiation protection (/api/contact/:token/call and /api/communication/:token/call)
router.route("/:token/call").post(initiateCallController);

// Registration number verification
router.route("/:token/verify").post(verifyRegNumController);
router.route("/:token/verify-reg").post(verifyRegNumController);

router.route("/:token/visit").post(recordTagVisitController);

export default router;