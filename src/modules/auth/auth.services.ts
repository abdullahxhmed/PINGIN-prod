import { BadRequestError, ForbiddenError, NotFoundError, UnauthorizedError } from "../../errors/AppError.js"
import {prisma} from "../../lib/prisma.js"
import dotenv from "dotenv"
import jwt from "jsonwebtoken";
import argon2 from "argon2"
import generateOtp from "../../utils/otp.js"
import { no } from "zod/v4/locales";
import crypto from "crypto";

dotenv.config();

const createAccessToken =  (userId:string) => {
    return jwt.sign(
        {sub: userId},
        process.env.JWT_SECRET!,
        {expiresIn: "15m"}
    );
    // console.log("Signing secret exists:", !!process.env.JWT_SECRET);
;}

const generateRefreshToken = async (userId:string) => {
    const rawToken = crypto.randomBytes(32).toString("base64url");

    const tokenHash = crypto
        .createHash("sha256")
        .update(rawToken)
        .digest("hex")

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    try{
       await prisma.refreshToken.create({
        data:{
            userId,
            tokenHash,
            expiresAt,
            revokedAt: null
        }
        });
        return rawToken;
    }
    catch(err){
        throw new BadRequestError("refresh token generation error");
    }

};


const refreshAccessToken = async (refreshToken:string) => {
    const hashedToken = crypto
        .createHash("sha256")
        .update(refreshToken)
        .digest("hex")
    
    const token = await prisma.refreshToken.findFirst({
        where: {tokenHash: hashedToken}
    })

    const now = new Date();
    if(!token || token.revokedAt || token.expiresAt <= now){
        throw new UnauthorizedError("Invalid refresh token");
    }

    const accessToken = createAccessToken(token.userId);
    return accessToken;

}

const getCurrentUser = async (userId:string) => {
    return prisma.user.findUnique({
        where:{
            id: userId,
            active: true
        },
        select: {
            id: true,
            name: true,
            mobileNumber: true,
            contactEndpoint: {
                select:{
                    type:true,
                    phoneNumber:true,
                },
            },
        },
    });
}




export {
    createAccessToken,
    refreshAccessToken,
    generateRefreshToken,
    getCurrentUser
}