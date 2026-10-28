import asyncHandler from "express-async-handler";
import {
  createUser,
  updateUserName,
  changeUserPassword,
} from "./users.service.js";
import {
  updateUserNameSchema,
  changePasswordSchema,
} from "./users.schema.js";
import { BadRequestError } from "../../errors/AppError.js";

/**
 * @description Create new user
 * @route POST /api/users
 * @access public
 */
const createUserController = asyncHandler(async (req, res, next) => {
  console.log(req.body);
  const user = await createUser(req.body.name, req.body.mobileNumber);
  res.status(201).json(user);
});

/**
 * @description Update user profile (name only)
 * @route PATCH /api/users/me, PATCH /api/users/profile
 * @access private
 */
const updateUserNameController = asyncHandler(async (req, res, next) => {
  const result = updateUserNameSchema.safeParse(req.body);
  if (!result.success) {
    const message = result.error.issues[0]?.message || "Invalid name data";
    throw new BadRequestError(message);
  }

  const updatedUser = await updateUserName(req.user.id, result.data.name);

  res.status(200).json({
    message: "Name updated successfully",
    user: updatedUser,
  });
});

/**
 * @description Change user password
 * @route POST /api/users/change-password, PUT /api/users/change-password
 * @access private
 */
const changePasswordController = asyncHandler(async (req, res, next) => {
  const result = changePasswordSchema.safeParse(req.body);
  if (!result.success) {
    const message = result.error.issues[0]?.message || "Invalid password data";
    throw new BadRequestError(message);
  }

  const currentPassword =
    result.data.currentPassword || result.data.oldPassword;

  const response = await changeUserPassword(
    req.user.id,
    currentPassword,
    result.data.newPassword
  );

  res.status(200).json(response);
});

export {
  createUserController,
  updateUserNameController,
  changePasswordController,
};