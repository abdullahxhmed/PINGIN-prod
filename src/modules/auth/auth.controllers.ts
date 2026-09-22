
import asyncHandler from "express-async-handler";
import { createAccessToken } from "./auth.services.js";
import { signupService } from "./signup/signup.service.js";
import { loginService } from "./login/login.service.js";


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

    await signupService.requestSignupOtp(mobileNumber);
    res.status(200).json({message: "OTP sent successfully"})
})

/**
 * @description Request Signup Verification/Create User
 * @route POST /api/auth/signup/verify-otp
 * @access public
 */
const verifySignupController = asyncHandler (async (req, res, next) =>{
    const {name, mobileNumber, otp} = req.body;

    const userDetails = await signupService.verifySignup(
        mobileNumber,
        otp,
        name
    )
    res.status(201).json(userDetails);
})

/**
 * @description Request Login OTP
 * @route POST /api/auth/login/request-otp
 * @access public
 */
const requestLoginOtpController = asyncHandler (async (req, res, next) => {
    const {mobileNumber} = req.body

    await loginService.requestLoginOtp(mobileNumber);
    res.status(200).json({message: "OTP sent successfully"})
})

/**
 * @description Request Login Verification
 * @route POST /api/auth/login/verify-otp
 * @access public
 */
const verifyLoginController = asyncHandler (async (req, res, next) =>{
    const {mobileNumber, otp} = req.body;

    const userDetails = await loginService.verifyLogin(
        mobileNumber,
        otp,
    )
    res.status(201).json(userDetails);
})





export {
    requestSignupOtpController, testLoginController, verifySignupController, requestLoginOtpController,
    verifyLoginController
};
