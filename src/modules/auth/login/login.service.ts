import { OtpPurpose } from "@prisma/client"
import { ConflictError, NotFoundError } from "../../../errors/AppError.js"
import { prisma } from "../../../lib/prisma.js"
import { createAccessToken } from "../auth.services.js"
import { otpService } from "../otp.service.js"


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


const verifyLogin = async (mobileNo: string, otp: string) => {
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
        OtpPurpose.SIGNUP
    );

    // OTP verfication succeeded if we reached here


    const accessToken = await createAccessToken(user.id);
    return {
        user: user,
        accessToken: accessToken
    }

}

export const loginService = {
    requestLoginOtp,
    verifyLogin
}