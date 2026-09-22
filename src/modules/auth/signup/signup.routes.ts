import express from "express"
import { requestSignupOtpController, verifySignupController } from "../auth.controllers.js";

const signupRouter = express.Router();

signupRouter
    .route("/request-otp")
    .post(requestSignupOtpController);

signupRouter
    .route("/verify-otp")
    .post(verifySignupController);


export default signupRouter