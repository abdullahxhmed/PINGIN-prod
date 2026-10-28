import { OtpPurpose } from "@prisma/client"
import { ConflictError, NotFoundError, UnauthorizedError } from "../../../errors/AppError.js"
import { prisma } from "../../../lib/prisma.js"
import { createAccessToken, generateRefreshToken } from "../auth.services.js"
import { otpService } from "../otp.service.js"
import argon2 from "argon2"
import { checkOtpRateLimit } from "../../../middleware/otp-rateLimiter.js"
import {
  decryptPhoneNumber,
  generatePhoneLookup,
  getPossibleUserMobileMatches,
} from "../../../utils/data-protection.js"

const requestLoginOtp = async (mobileNo:string, ip:string) => {
    await checkOtpRateLimit(mobileNo,ip);
    const lookup = generatePhoneLookup(mobileNo);
    const user = await prisma.user.findFirst({
        where: {
            OR: [
                { mobileLookup: lookup },
                { mobileNumber: { in: getPossibleUserMobileMatches(mobileNo) } },
            ],
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
    // Prove that this phone number passed login OTP verification
    await otpService.verifyOtp(
        mobileNo,
        otp,
        OtpPurpose.LOGIN
    );

    // check whether user exists or not
    const lookup = generatePhoneLookup(mobileNo);
    const user = await prisma.user.findFirst({
        where: {
            OR: [
                { mobileLookup: lookup },
                { mobileNumber: { in: getPossibleUserMobileMatches(mobileNo) } },
            ],
            active: true
        },
        select: {
            id: true,
            name: true,
            mobileNumber: true,
            role: true,
        },
    });
    if(!user){
        throw new NotFoundError("Signup before logging in");
    }

    const accessToken = createAccessToken(user.id);
    const refreshToken = await generateRefreshToken(user.id);
    return {
        user: {
            id: user.id,
            name: user.name,
            mobileNumber: decryptPhoneNumber(user.mobileNumber),
            role: user.role,
        },
        accessToken: accessToken,
        refreshToken: refreshToken
    }
}

const verifyLoginPassword = async (
  mobileNo: string,
  password: string
) => {
  const lookup = generatePhoneLookup(mobileNo);
  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { mobileLookup: lookup },
        { mobileNumber: { in: getPossibleUserMobileMatches(mobileNo) } },
      ],
      active: true,
    },
    select: {
      id: true,
      name: true,
      mobileNumber: true,
      role: true,
      passwordHash: true,
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
      mobileNumber: decryptPhoneNumber(user.mobileNumber),
      role: user.role,
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
