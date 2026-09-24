import { ResourceType } from "@prisma/client";
import { randomBytes } from "crypto";
import { InternalError, NotFoundError } from "../../errors/AppError.js";
import { prisma } from "../../lib/prisma.js";
import { buildContactUrl } from "../public-contact/contact.services.js";

type vehicleDetailsInput = {
    registrationNum?:string;
    vehicleColour?:string;
}

const createResource = async (userId:string,name: string, type: ResourceType, vehicleDetails?:vehicleDetailsInput) => {

    const token = randomBytes(32).toString("hex");

    try{
        const {resource, contactLink, vehicle} = await prisma.$transaction(async (tx) => {
            console.log("TRANSACTION STARTED");
            const resource = await tx.resource.create({
                data: {
                    userId,
                    name,
                    type
                }
            });

            const contactLink = await tx.contactLink.create({
                data: {
                    resourceId: resource.id,
                    token: token
                }
            });
            console.log("contact link created");
            let vehicle = null;
            if(type === "VEHICLE" && vehicleDetails){
                vehicle = await tx.vehicleDetail.create({
                    data: {
                        resourceId: resource.id,
                        registrationNum: vehicleDetails.registrationNum ?? null,
                        vehicleColour: vehicleDetails.vehicleColour ?? null,
                    }
                });
            }
            return {resource, contactLink, vehicle};
        })
            
        const contactUrl = buildContactUrl(contactLink.token);
        return {resource, contactUrl, vehicle};

    }
    catch(err){
        console.log(err);
        throw new InternalError("Something went wrong, Please Try again.");
    }
  
}

const getResources = async (userId:string) => {
    const resources = await prisma.resource.findMany({
        where:{
            userId,
            active: true
        },
        include: {
            contactLink: true
        }
    });
    if(!resources)
        throw new NotFoundError("Resources not found!");

    return resources.map((resource) => ({
        id: resource.id,
        name: resource.name,
        contactUrl: buildContactUrl(resource.contactLink!.token)
    }))
}


const getResourceById = async (resourceId: string, userId: string) => {
    const resource = await prisma.resource.findFirst({
        where:{
            id: resourceId,
            userId,
            active: true,
        },
        include: {
            contactLink: true
        }
    })
    if(!resource)
        throw new NotFoundError("Resource not found")
    return {
        id: resource.id,
        name: resource.name,
        contactUrl: buildContactUrl(resource.contactLink!.token)
    }
}

const modifyResourceById = async (resourceId : string, userId: string, updateVal:string) => {
    const updatedResource = await prisma.resource.update({
        where:{
            id: resourceId,
            userId,
            active: true
        },
        data:{
            name : updateVal
        }
    })
    return {
        id: updatedResource.id,
        name: updatedResource.name
    };
}

const deleteResourceById = async (
    resourceId: string,
     userId: string,
    ) => {
        try{
            await prisma.resource.update({
                where: {
                    id: resourceId,
                    userId,
                    active: true
                },
                data: {
                    active: false  //soft delete no active deletes
                }
            })
            console.log("Deleted Resource");
        }
        catch(err){
            throw new Error;
        }

    }






export {
    createResource, deleteResourceById, getResourceById, getResources, modifyResourceById
};
