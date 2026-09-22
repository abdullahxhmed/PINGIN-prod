import { OtpPurpose } from "@prisma/client"
import { ConflictError } from "../../../errors/AppError.js"
import { prisma } from "../../../lib/prisma.js"
import { createAccessToken } from "../auth.services.js"
import { otpService } from "../otp.service.js"

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

const verifySignup = async (mobileNo: string, otp: string, userName: string) => {
    // Prove that this phone number passed signup OTP verification
    await otpService.verifyOtp(
        mobileNo,
        otp,
        OtpPurpose.SIGNUP
    );

    // OTP verfication succeeded if we reached here

    //Create new user
    const user = await prisma.user.create({
        data: {
            name: userName,
            mobileNumber: mobileNo
        }
    });

    await prisma.contactEndpoint.create({
        data: {
            userId: user.id,
            type: "PHONE",
            phoneNumber: mobileNo
        }
    })

    const accessToken = await createAccessToken(user.id);
    return {
        user: user,
        accessToken: accessToken
    }

}



export const signupService = {
    requestSignupOtp,
    verifySignup
}