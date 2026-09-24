import asyncHandler from "express-async-handler";
import { addVehicleDetails } from "./vehicleDetails.service.js";


/**
 * @description Post vehicle details
 * @route POST /api/auth/vehicle-details
 * @access public
 */
const addVehicleDetailsController = asyncHandler (async (req, res, next) => {
    const {type, resourceId, registrationNum, vehicleColour} = req.body;
    if(type === "VEHICLE"){
            const vehicleDetails = await addVehicleDetails(resourceId,registrationNum,vehicleColour);
            res.status(200).json(vehicleDetails);
    }
    else
        next();

})

export {
    addVehicleDetailsController
}