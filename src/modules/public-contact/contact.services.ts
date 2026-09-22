import { NotFoundError } from "../../errors/AppError.js";
import {prisma} from "../../lib/prisma.js"

const getContact = async (contactToken: string) => {
    const contactDetails = await prisma.contactLink.findUnique({
        where: {
            token: contactToken,
            active:true,
            resource: {
                active:true
            }
        },
        select:{
            resource:{
                select:{
                    name:true
                }
            }
        }
    });
    if(!contactDetails)
        throw new NotFoundError("Resource not found");

    return {
        name: contactDetails.resource.name
    };
}


export {
    getContact
}