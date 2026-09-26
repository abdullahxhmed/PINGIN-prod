import asyncHandler from "express-async-handler";
import { z } from "zod";
import { BadRequestError } from "../../errors/AppError.js";
import { initiateCall } from "../communication/communication.service.js";
import { getContact, verifyRegistrationNum } from "./contact.services.js";
import { edesyService } from "../../integrations/edesy.service.js";

/**
 * @description Get public resource details
 * @route GET /api/contact/:token
 * @access public
 */

const getContactController = asyncHandler (async (req,res,next) => {
     const {token} = req.params;
    
        if(typeof token !== "string"){
            throw new BadRequestError("Resource ID is required");
        }
    const resource = await getContact(
        token
    )
    res.status(200).json(resource);
})

const verifyRegNumController = asyncHandler (async (req, res, next) =>{
    const {registrationNum} = req.body; 
    const {token} = req.params;
    if (typeof token !== "string" || typeof registrationNum !== "string") {
        throw new BadRequestError("Invalid contact token or registrationNum");
    }
    await verifyRegistrationNum(token, registrationNum);
    res.status(200).json({
        success: true,
        message: "verified"
    });

})
const callSchema = z.object({
  phoneNumber: z.string().min(10).max(13),
});

/**
 * @description Initiate a private communication session/cal
 * @route GET /api/contact/:token/call
 * @access public
 */


export {
    getContactController,
    verifyRegNumController
};
