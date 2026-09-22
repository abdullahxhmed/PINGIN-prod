import express from "express"
import { requestSignupOtpController, testLoginController } from "./auth.controllers.js"
import { authenticateRequest } from "./auth.middleware.js";
import signupRouter from "./signup/signup.routes.js";
import loginRouter from "./login/login.routes.js";


const router = express.Router()


router.use("/signup", signupRouter);
router.use("/login", loginRouter);

export default router;