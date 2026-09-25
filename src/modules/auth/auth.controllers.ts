
import asyncHandler from "express-async-handler";
import { createAccessToken, getCurrentUser, refreshAccessToken } from "./auth.services.js";
import { signupService } from "./signup/signup.service.js";
import { loginService } from "./login/login.service.js";
import { passwordLoginSchema, verifySignupSchema } from "./auth.schema.js";
import { BadRequestError } from "../../errors/AppError.js";


/**
 * @description Post temporary login
 * @route POST /api/auth/test-login
 * @access public
 */
const testLoginController = asyncHandler (async (req, res, next) => {
    const {userId} = req.body;

    const accessToken = await createAccessToken(userId);
    res.status(200).json({accessToken});

})

/**
 * @description Request Signup OTP
 * @route POST /api/auth/signup/request-otp
 * @access public
 */
const requestSignupOtpController = asyncHandler (async (req, res, next) => {
    const {mobileNumber} = req.body

    await signupService.requestSignupOtp(mobileNumber, req.ip!);
    res.status(200).json({message: "OTP sent successfully"})
})

/**
 * @description Request Signup Verification/Create User
 * @route POST /api/auth/signup/verify-otp
 * @access public
 */
const verifySignupController = asyncHandler (async (req, res, next) =>{

    const result = verifySignupSchema.safeParse(req.body);
    if(!result.success){
        throw new BadRequestError("Invalid signup data");
    }
    const {name, mobileNumber,password, otp} = result.data;

    const signupDetails = await signupService.verifySignup(
        mobileNumber,
        password,
        otp,
        name
    )
    res.cookie("refreshToken", signupDetails.refreshToken, {
        httpOnly:true,
        secure:process.env.NODE_ENV === "production",
        sameSite:"lax"
    })
    res.status(201).json({
        user: signupDetails.user,
        accessToken: signupDetails.accessToken
    });
})

/**
 * @description Request Login OTP
 * @route POST /api/auth/login/request-otp
 * @access public
 */
const requestLoginOtpController = asyncHandler (async (req, res, next) => {
    const {mobileNumber} = req.body

    await loginService.requestLoginOtp(mobileNumber, req.ip!);
    res.status(200).json({message: "OTP sent successfully"})
})

/**
 * @description Request Login Verification
 * @route POST /api/auth/login/verify-otp
 * @access public
 */
const verifyLoginOtpController = asyncHandler (async (req, res, next) =>{
    const {mobileNumber, otp} = req.body;

    const loginDetails = await loginService.verifyLoginOtp(
        mobileNumber,
        otp,
    )
    res.cookie("refreshToken", loginDetails.refreshToken, {
        httpOnly:true,
        secure:process.env.NODE_ENV === "production",
        sameSite:"lax"
    })
    res.status(201).json({
        user: loginDetails.user,
        accessToken: loginDetails.accessToken
    });
})


/**
 * @description Request Login Verification
 * @route POST /api/auth/login/verify
 * @access public
 */
const verifyLoginPassController = asyncHandler (async (req, res, next) =>{
    const result = passwordLoginSchema.safeParse(req.body);
    if(!result.success){
        throw new BadRequestError("Invalid login data");
    }
    const {mobileNumber, password} = result.data;

    const loginDetails = await loginService.verifyLoginPassword(
        mobileNumber,
        password,
    )
    res.cookie("refreshToken", loginDetails.refreshToken, {
        httpOnly:true,
        secure:process.env.NODE_ENV === "production",
        sameSite:"lax"
    })
    res.status(201).json({
        user: loginDetails.user,
        accessToken: loginDetails.accessToken
    });
})


/**
 * @description Refresh Access Token
 * @route POST /api/auth/refresh
 * @access private
 */
const refreshAccessTokenController = asyncHandler (async (req,res, next) => {
    const refreshToken = req.cookies?.refreshToken ||
    (req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7): null) ||
    req.body?.refreshToken;

    if (!refreshToken) {
        res.status(401).json({message: "Refresh Token is required"});
        return;
    }

    const accessToken = await refreshAccessToken(refreshToken);
    res.status(200).json({accessToken:accessToken});
})



/**
 * @description Get user info
 * @route GET /api/auth/me
 * @access private
 */
const getMeController = asyncHandler (async (req, res, next) => {
    const userId = req.user.id;

    const getMe = await getCurrentUser(userId);
    res.status(200).json(getMe);
})



export const authControllers = {
    requestSignupOtpController,
    testLoginController,
    verifySignupController,
    requestLoginOtpController,
    verifyLoginOtpController,
    refreshAccessTokenController,
    getMeController,
    verifyLoginPassController
};
