import express from "express";
import { authControllers } from "./auth.controllers.js";
import signupRouter from "./signup/signup.routes.js";
import loginRouter from "./login/login.routes.js";
import { authenticateRequest } from "./auth.middleware.js";
import {
  updateUserNameController,
  changePasswordController,
} from "../users/users.controller.js";

const router = express.Router();

router.use("/signup", signupRouter);
router.use("/login", loginRouter);
router
  .route("/refresh")
  .post(authControllers.refreshAccessTokenController);

router
  .route("/logout")
  .post(authControllers.logoutController);

router
  .route("/me")
  .get(authenticateRequest, authControllers.getMeController)
  .patch(authenticateRequest, updateUserNameController);

router
  .route("/change-password")
  .post(authenticateRequest, changePasswordController)
  .put(authenticateRequest, changePasswordController);

export default router;