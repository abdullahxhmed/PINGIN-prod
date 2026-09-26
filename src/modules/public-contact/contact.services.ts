import { AppError, ForbiddenError, InternalError, NotFoundError } from "../../errors/AppError.js";
import {prisma} from "../../lib/prisma.js"
import {CommunicationSessionType} from "@prisma/client";
import crypto from "crypto"
import { edesyService } from "../../integrations/edesy.service.js";

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
            id: true,
            resource:{
                select:{
                    name:true,
                    vehicleDetail:{
                        select:{
                            registrationNum:true,
                            vehicleColour:true
                        }
                    }
                },
            },

        },
    });
    if(!contactDetails)
        throw new NotFoundError("Resource not found");

    const hasRegistrationNumber = !!contactDetails.resource.vehicleDetail?.registrationNum;

    return {
        id:contactDetails.id,
        name: contactDetails.resource.name,
        hasRegistrationNumber,
        vehicleDetails:{
            colour: contactDetails.resource.vehicleDetail?.vehicleColour
        }
    };
}

function buildContactUrl(token: string) {
  return `${process.env.PUBLIC_APP_URL}/contact/${token}`;
}


const createCommunicationSession = async (
    token: string,
    type: CommunicationSessionType,
    visitorPhoneNumber: string,
) => {
    try{
        const contact = await getCommunicationContact(token);

    const session = await prisma.communicationSession.create({
        data: {
            reference: generateReference(),
            resourceId: contact.resourceId,
            contactLinkId: contact.contactLinkId,
            contactEndpointId: contact.contactEndpointId,
            contactorPhoneNumber: visitorPhoneNumber,
            type,
            status: "PENDING",
        },
    })
    return session;
  
    }
    catch(err){
        if(err instanceof AppError){
            throw err;
        }
        throw new InternalError("could not create session, please try again");
    }
}



const getCommunicationContact = async (token: string) => {
    const contactLink = await prisma.contactLink.findFirst({
        where: {
            token,
            active: true,
            resource: {
                active: true,
            },
        },
        select: {
            id: true,
            resourceId: true,
            resource: {
                select: {
                    user: {
                        select: {
                            contactEndpoint: {
                                select: {
                                    id: true,
                                    phoneNumber:true
                                },
                            },
                        },
                    },
                },
            },
        },
    });

    if (!contactLink) {
        throw new NotFoundError("Contact link not found");
    }

    const contactEndpoint =
        contactLink.resource.user.contactEndpoint;

    if (!contactEndpoint) {
        throw new InternalError(
            "Contact endpoint not configured"
        );
    }

    return {
        contactLinkId: contactLink.id,
        resourceId: contactLink.resourceId,
        contactEndpointId: contactEndpoint.id,
        contactEndpointPhoneNumber: contactEndpoint.phoneNumber
    };
};


function generateReference(){
    return `PK-${crypto.randomBytes(8).toString("hex")}`
}

const verifyRegistrationNum = async (token:string, submittedRegNo: string) => {
    const contactDetails = await prisma.contactLink.findUnique({
        where: {
            token,
            active: true,
            resource:{
                active:true
            }
        },
        select: {
            resource:{
                select:{
                    vehicleDetail:{
                        select:{
                            registrationNum: true
                        },
                    },
                },
            },
        },
    });
    const existingRegNo = contactDetails?.resource.vehicleDetail?.registrationNum;

    if(!existingRegNo)
        throw new NotFoundError("registrationNum not found");
    else if(existingRegNo !== submittedRegNo){
        throw new ForbiddenError("Registration number does not match");
    }
    return true;
}

export {
    getContact,
    buildContactUrl,
    generateReference,
    createCommunicationSession,
    getCommunicationContact,
    verifyRegistrationNum
}