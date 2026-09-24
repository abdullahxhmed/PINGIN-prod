import express from "express"
import { authControllers } from "../auth.controllers.js";

const signupRouter = express.Router();

signupRouter
    .route("/request-otp")
    .post(authControllers.requestSignupOtpController);

signupRouter
    .route("/verify-otp")
    .post(authControllers.verifySignupController);


export default signupRouter