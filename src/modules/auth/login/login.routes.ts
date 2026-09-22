import {Router} from "express";
import { requestLoginOtpController, verifyLoginController } from "../auth.controllers.js";

const loginRouter = Router();

loginRouter
    .route("/request-otp")
    .post(requestLoginOtpController)

loginRouter
    .route("/verify-otp")
    .post(verifyLoginController);

export default loginRouter;