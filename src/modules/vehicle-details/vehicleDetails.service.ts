import { NotFoundError } from "../../errors/AppError.js";
import { prisma } from "../../lib/prisma.js";


const addVehicleDetails = async (
    resourceId: string,
    registrationNum: string,
    vehicleColour: string
) => {
    const resource = await prisma.resource.findFirst({
        where: {
            id: resourceId,
            active: true
        }
    });
    if(!resource){
        throw new NotFoundError("Resource Not found");
    }
    const vehicleDetails = await prisma.vehicleDetail.create({
        data: {
            resourceId : resource.id,
            registrationNum: registrationNum,
            vehicleColour: vehicleColour
        }
    })
    return vehicleDetails;
}

export {
    addVehicleDetails
};
