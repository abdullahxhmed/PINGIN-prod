import { Prisma } from "@prisma/client";
import { randomBytes } from "crypto";
import { ConflictError, NotFoundError } from "../../errors/AppError.js";
import { prisma } from "../../lib/prisma.js";

const createResource = async (userId:string,name: string) => {
    const resource = await prisma.resource.create({
        data:{
            userId,
            name,
        }
    })
    return resource;
}

const getResources = async (userId:string) => {
    const resources = await prisma.resource.findMany({
        where:{
            userId,
            active: true
        }
    });
    if(!resources)
        throw new NotFoundError("Resources not found!")
    return resources;
}


const getResourceById = async (resourceId: string, userId: string) => {
    const resource = await prisma.resource.findFirst({
        where:{
            id: resourceId,
            userId,
            active: true,
        }
    })
    if(!resource)
        throw new NotFoundError("Resource not found")
    return resource;
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
    return updatedResource;
}

const deleteResourceById = async (
    resourceId: string,
     userId: string,
    ) => {
        const deletedResource = await prisma.resource.update({
            where: {
                id: resourceId,
                userId,
                active: true
            },
            data: {
                active: false  //soft delete no active deletes
            }
        })
        return deletedResource;
    }



const createContactLink = async (resourceId : string, userId: string) => {
    const token = randomBytes(32).toString("hex");
    const existingContactLink = await prisma

    const resource = await prisma.resource.findFirst({
        where:{
            id: resourceId,
            userId,
            active: true
        }
    })
    if(!resource)
        throw new NotFoundError("Resource not found");

    try{
        const contactLink = await prisma.contactLink.create({
        data: {
            resourceId,
            token
        }
        });
        return contactLink;
    }
    catch(error){
        if (
            error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
        ){
            throw new ConflictError("Resource already has a contact link");
        }
        throw error;
    }

}


export {
    createContactLink, createResource, deleteResourceById, getResourceById, getResources, modifyResourceById
};
