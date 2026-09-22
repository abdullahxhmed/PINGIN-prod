import { BadRequestError, ForbiddenError, NotFoundError } from "../../errors/AppError.js"
import {prisma} from "../../lib/prisma.js"
import dotenv from "dotenv"
import jwt from "jsonwebtoken";
import argon2 from "argon2"
import generateOtp from "../../utils/otp.js"
import { no } from "zod/v4/locales";


dotenv.config();

const createAccessToken = async (userId:string) => {
    return jwt.sign(
        {sub: userId},
        process.env.JWT_SECRET!,
        {expiresIn: "15m"}
    );
    // console.log("Signing secret exists:", !!process.env.JWT_SECRET);
;}









export {
    createAccessToken,

}