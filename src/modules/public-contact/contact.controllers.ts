import asyncHandler from "express-async-handler";
import { BadRequestError } from "../../errors/AppError.js";
import { getContact } from "./contact.services.js";

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



export {
    getContactController
}