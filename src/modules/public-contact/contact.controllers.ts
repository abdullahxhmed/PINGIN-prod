import asyncHandler from "express-async-handler";
import { z } from "zod";
import { BadRequestError } from "../../errors/AppError.js";
import { initiateCall } from "../communication/communication.service.js";
import { getContact } from "./contact.services.js";
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


const callSchema = z.object({
  phoneNumber: z.string().min(10).max(13),
});

/**
 * @description Initiate a private communication session/cal
 * @route GET /api/contact/:token/call
 * @access public
 */
const initiateCallController = asyncHandler (async(
  req,
  res,
  next
) => {
  try {
    const { token } = req.params;

      if (!token || Array.isArray(token)) {
          throw new BadRequestError("Invalid contact token");
      }

      const result = await initiateCall({
          token,
          visitorPhoneNumber: req.body.phoneNumber,
      });

    res.status(201).json({
      data: result,
    });
  } catch (error) {
    next(error);
  }
});

export {
    getContactController,
    initiateCallController
};
