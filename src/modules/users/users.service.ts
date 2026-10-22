import { prisma } from "../../lib/prisma.js";
import { BadRequestError, NotFoundError } from "../../errors/AppError.js";
import argon2 from "argon2";

const createUser = async (name: string, mobileNumber: string) => {
  console.time("create-user");
  const user = await prisma.user.create({
    data: {
      name,
      mobileNumber,
    },
  });
  console.log(user);
  return user;
};

const getUsers = async () => {
  const users = await prisma.user.findMany();
  return users;
};

const updateUserName = async (userId: string, name: string) => {
  const existingUser = await prisma.user.findUnique({
    where: { id: userId, active: true },
    select: { id: true },
  });

  if (!existingUser) {
    throw new NotFoundError("User not found");
  }

  const updatedUser = await prisma.user.update({
    where: { id: userId },
    data: { name },
    select: {
      id: true,
      name: true,
      mobileNumber: true,
      role: true,
      active: true,
      createdAt: true,
      updatedAt: true,
      contactEndpoint: {
        select: {
          type: true,
          phoneNumber: true,
        },
      },
    },
  });

  return updatedUser;
};

const changeUserPassword = async (
  userId: string,
  currentPassword: string | undefined,
  newPassword: string
) => {
  const user = await prisma.user.findUnique({
    where: { id: userId, active: true },
    select: { id: true, passwordHash: true },
  });

  if (!user) {
    throw new NotFoundError("User not found");
  }

  // If user already has a password, verify current password
  if (user.passwordHash) {
    if (!currentPassword) {
      throw new BadRequestError("Current password is required");
    }

    const isMatch = await argon2.verify(user.passwordHash, currentPassword);
    if (!isMatch) {
      throw new BadRequestError("Incorrect current password");
    }

    const isSame = await argon2.verify(user.passwordHash, newPassword);
    if (isSame) {
      throw new BadRequestError("New password cannot be the same as current password");
    }
  }

  const newPasswordHash = await argon2.hash(newPassword);

  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: newPasswordHash },
  });

  return { message: "Password changed successfully" };
};

export {
  createUser,
  getUsers,
  updateUserName,
  changeUserPassword,
};