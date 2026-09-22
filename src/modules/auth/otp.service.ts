import {prisma} from "../../lib/prisma.js"
import generateOtp from "../../utils/otp.js"
import argon2 from "argon2"
import { ForbiddenError, BadRequestError } from "../../errors/AppError.js"
import {OtpPurpose} from "@prisma/client"


const requestOtp = async (mobileNumber: string, purpose: OtpPurpose) => {
    const otp = generateOtp();

    const otpHash = await argon2.hash(otp);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await prisma.otpVerification.create({
        data: {
            mobileNumber,
            otpHash,
            expiresAt,
            purpose
        }
    })

    console.log(`OTP for ${mobileNumber}: ${otp}`);

}

const verifyOtp = async (mobileNumber:string, otp:string, purpose: OtpPurpose) => {
    const otpRecord = await prisma.otpVerification.findFirst({
        where: {
            mobileNumber,
            purpose,
            usedAt: null,
        }
    })
    const now = new Date();

    if(otpRecord?.expiresAt! <= now){
        throw new ForbiddenError("OTP has expired")
    }
    if(!otpRecord?.otpHash){
        throw new Error;
    }
    
    const valid = await argon2.verify(
        otpRecord.otpHash,
        otp
    )
    if(!valid){
        await prisma.otpVerification.update({
            where: {id: otpRecord.id},
            data:{ attempts: {increment:1}}
        })
        throw new ForbiddenError("Invalid OTP");
    }

    await prisma.otpVerification.update({
        where: {id: otpRecord.id},
        data: {usedAt: new Date()}
    })

}

export const otpService ={
    requestOtp,
    verifyOtp
}