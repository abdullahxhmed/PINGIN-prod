import { OtpPurpose } from "@prisma/client"
import { ConflictError } from "../../../errors/AppError.js"
import { prisma } from "../../../lib/prisma.js"
import { createAccessToken, generateRefreshToken } from "../auth.services.js"
import { otpService } from "../otp.service.js"
import argon2 from "argon2"

const requestSignupOtp = async (mobileNo:string) => {
    const user = await prisma.user.findUnique({
        where: {
            mobileNumber: mobileNo
        }
    })
    if(!user){
        return await otpService.requestOtp(
            mobileNo,
            OtpPurpose.SIGNUP
        )
    }
    else
        throw new ConflictError("User already Exists");
}

const verifySignup = async (mobileNo: string,password:string, otp: string, userName: string) => {
    // Prove that this phone number passed signup OTP verification
    await otpService.verifyOtp(
        mobileNo,
        otp,
        OtpPurpose.SIGNUP
    );

    // OTP verfication succeeded if we reached here
    const hashedPassword = await argon2.hash(password);

    //Create new user
    try{
        const {user} = await prisma.$transaction(async (tx) => {
            console.log("user creation transaction started")
            const user = await prisma.user.create({
                data: {
                    name: userName,
                    mobileNumber: mobileNo,
                    passwordHash: hashedPassword
                }
            });

            const contactEndpoint = await prisma.contactEndpoint.create({
                data: {
                    userId: user.id,
                    type: "PHONE",
                    phoneNumber: mobileNo
                }
            });

            return {user, contactEndpoint};
            })
            
            
        const accessToken = createAccessToken(user.id);
        const refreshToken = await generateRefreshToken(user.id);
        return {
            user: {
                id: user.id,
                name: user.name,
                mobileNo: user.mobileNumber
            },
            accessToken: accessToken,
            refreshToken: refreshToken
        }
    }
    catch(err){
        throw new Error;
    }
    


}



export const signupService = {
    requestSignupOtp,
    verifySignup
}