import { OtpPurpose } from "@prisma/client"
import { ConflictError, NotFoundError, UnauthorizedError } from "../../../errors/AppError.js"
import { prisma } from "../../../lib/prisma.js"
import { createAccessToken, generateRefreshToken } from "../auth.services.js"
import { otpService } from "../otp.service.js"
import argon2 from "argon2"


const requestLoginOtp = async (mobileNo:string) => {
    const user = await prisma.user.findUnique({
        where: {
            mobileNumber: mobileNo
        }
    });
    if(!user){
        throw new NotFoundError("Signup before login");
    }
    return await otpService.requestOtp(
        mobileNo,
        OtpPurpose.LOGIN
    )

}


const verifyLoginOtp = async (mobileNo: string, otp: string) => {
    //check whether user exists or not
     const user = await prisma.user.findUnique({
        where: {
            mobileNumber: mobileNo,
            active: true
        },
    });
    if(!user){
        throw new NotFoundError("Signup before logging in");
    }

    // Prove that this phone number passed login OTP verification
    await otpService.verifyOtp(
        mobileNo,
        otp,
        OtpPurpose.LOGIN
    );

    // OTP verfication succeeded if we reached here


    const accessToken = createAccessToken(user.id);
    const refreshToken = await generateRefreshToken(user.id);
    return {
        user: user,
        accessToken: accessToken,
        refreshToken: refreshToken
    }

}

const verifyLoginPassword = async (
  mobileNo: string,
  password: string
) => {
  const user = await prisma.user.findUnique({
    where: {
      mobileNumber: mobileNo,
      active: true,
    },
  });

  if (!user || !user.passwordHash) {
    throw new UnauthorizedError("Invalid credentials");
  }

  const isValidPassword = await argon2.verify(
    user.passwordHash,
    password
  );

  if (!isValidPassword) {
    throw new UnauthorizedError("Invalid credentials");
  }

  const accessToken = createAccessToken(user.id);
  const refreshToken = await generateRefreshToken(user.id);

  return {
    user: {
      id: user.id,
      name: user.name,
      mobileNumber: user.mobileNumber,
    },
    accessToken,
    refreshToken,
  };
};

export const loginService = {
    requestLoginOtp,
    verifyLoginOtp,
    verifyLoginPassword
}