import express from "express";
import {
  createUserController,
  updateUserNameController,
  changePasswordController,
} from "./users.controller.js";
import { authenticateRequest } from "../auth/auth.middleware.js";

const router = express.Router();

router.route("/").post(createUserController);

// Update user details (name only)
router
  .route("/me")
  .patch(authenticateRequest, updateUserNameController);

router
  .route("/profile")
  .patch(authenticateRequest, updateUserNameController);

// Change password
router
  .route("/change-password")
  .post(authenticateRequest, changePasswordController)
  .put(authenticateRequest, changePasswordController);

export default router;