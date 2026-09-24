import {Router} from "express";
import { authControllers } from "../auth.controllers.js";

const loginRouter = Router();

loginRouter
    .route("/request-otp")
    .post(authControllers.requestLoginOtpController)

loginRouter
    .route("/verify-otp")
    .post(authControllers.verifyLoginOtpController);

loginRouter
    .route("/verify")
    .post(authControllers.verifyLoginPassController);

export default loginRouter;