import { z } from "zod";

export const updateUserNameSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Name must be at least 2 characters long")
    .max(100, "Name must not exceed 100 characters"),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z
      .string()
      .min(1, "Current password cannot be empty")
      .optional(),
    oldPassword: z
      .string()
      .min(1, "Old password cannot be empty")
      .optional(),
    newPassword: z
      .string()
      .min(8, "New password must be at least 8 characters long")
      .max(128, "New password must not exceed 128 characters"),
    confirmPassword: z.string().optional(),
  })
  .refine(
    (data) => {
      if (data.confirmPassword && data.newPassword !== data.confirmPassword) {
        return false;
      }
      return true;
    },
    {
      message: "New password and confirmation password do not match",
      path: ["confirmPassword"],
    }
  );

export type UpdateUserNameInput = z.infer<typeof updateUserNameSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
