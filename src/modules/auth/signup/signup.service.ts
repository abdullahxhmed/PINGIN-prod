import { OtpPurpose } from "@prisma/client"
import { ConflictError } from "../../../errors/AppError.js"
import { prisma } from "../../../lib/prisma.js"
import { createAccessToken, generateRefreshToken } from "../auth.services.js"
import { otpService } from "../otp.service.js"
import { checkOtpRateLimit } from "../../../middleware/otp-rateLimiter.js";
import argon2 from "argon2"
import {
  encryptPhoneNumber,
  decryptPhoneNumber,
  generatePhoneLookup,
  getPossibleUserMobileMatches,
} from "../../../utils/data-protection.js";

const requestSignupOtp = async (mobileNo:string, ip:string) => {
    const lookup = generatePhoneLookup(mobileNo);
    const user = await prisma.user.findFirst({
        where: {
            OR: [
                { mobileLookup: lookup },
                { mobileNumber: { in: getPossibleUserMobileMatches(mobileNo) } },
            ],
        },
    });
    if(user){
        throw new ConflictError("User already Exists");
    }
    await checkOtpRateLimit(mobileNo, ip)
     return await otpService.requestOtp(
            mobileNo,
            OtpPurpose.SIGNUP
        )
}

const verifySignup = async (mobileNo: string,password:string, otp: string, userName: string) => {
    // Prove that this phone number passed signup OTP verification
    await otpService.verifyOtp(
        mobileNo,
        otp,
        OtpPurpose.SIGNUP
    );

    // OTP verification succeeded if we reached here
    const hashedPassword = await argon2.hash(password);

    // Create new user
    const { user } = await prisma.$transaction(async (tx) => {
        const lookup = generatePhoneLookup(mobileNo);
        const encryptedPhone = encryptPhoneNumber(mobileNo);

        const newUser = await tx.user.create({
            data: {
                name: userName,
                mobileNumber: encryptedPhone,
                mobileLookup: lookup,
                passwordHash: hashedPassword,
            },
        });

        const contactEndpoint = await tx.contactEndpoint.create({
            data: {
                userId: newUser.id,
                type: "PHONE",
                phoneNumber: encryptedPhone,
                phoneEncrypted: encryptedPhone,
                phoneLookup: lookup,
            },
        });

        return { user: newUser, contactEndpoint };
    });

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
        refreshToken: refreshToken,
    };
};



export const signupService = {
    requestSignupOtp,
    verifySignup
}