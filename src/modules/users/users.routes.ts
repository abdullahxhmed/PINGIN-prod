import express from "express";
import { createUserController, getUsersController } from "./users.controller.js";

const router = express.Router();

router.route('/').post(createUserController).get(getUsersController);

export default router;