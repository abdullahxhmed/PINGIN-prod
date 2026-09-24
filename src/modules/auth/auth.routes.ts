import express from "express"
import { authControllers } from "./auth.controllers.js"
import signupRouter from "./signup/signup.routes.js";
import loginRouter from "./login/login.routes.js";
import { authenticateRequest } from "./auth.middleware.js";


const router = express.Router()


router.use("/signup", signupRouter);
router.use("/login", loginRouter);
router
    .route('/refresh')
    .post(authControllers.refreshAccessTokenController);

router.get("/me", authenticateRequest, authControllers.getMeController);


export default router;