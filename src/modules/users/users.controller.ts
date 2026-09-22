import express from "express";
import asyncHandler from "express-async-handler";
import { nextTick } from "node:process";
import { createUser, getUsers } from "./users.service.js";

// const router = express.Router();



/**
 * @description Create new user
 * @route POST /api/users
 * @access public
 */
const createUserController = asyncHandler(async (req, res,next) => {
    console.log(req.body);
        const user = await createUser(
            req.body.name,
            req.body.mobileNumber
        )
        res.status(201).json(user);
});


/**
 * @description Get all users
 * @route GET /api/users
 * @access public
 */
const getUsersController = asyncHandler(async (req, res, next) => {
        const users = await getUsers();
        res.status(200).json(users);
})

// export default router;
export {
    createUserController,
    getUsersController
}