import express from "express";
import {
  getContactController,
  verifyRegNumController,
  recordTagVisitController,
} from "./contact.controllers.js";

const router = express.Router();

router.route("/:token").get(getContactController);

router.route("/:token/verify").post(verifyRegNumController);

router.route("/:token/visit").post(recordTagVisitController);

export default router;