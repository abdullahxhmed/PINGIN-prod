import { AppError, ForbiddenError, InternalError, NotFoundError } from "../../errors/AppError.js";
import {prisma} from "../../lib/prisma.js"
import {CommunicationSessionType} from "@prisma/client";
import crypto from "crypto"
import { edesyService } from "../../integrations/edesy.service.js";
import { encryptPhoneNumber, decryptPhoneNumber, decryptData, isEncrypted, generatePhoneLookup } from "../../utils/data-protection.js";

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
        name: decryptData(contactDetails.resource.name),
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
    visitId?: string,
) => {
    try{
        const contact = await getCommunicationContact(token);

        const plainVisitor = isEncrypted(visitorPhoneNumber)
            ? decryptPhoneNumber(visitorPhoneNumber)
            : visitorPhoneNumber.trim();

    const session = await prisma.communicationSession.create({
        data: {
            reference: generateReference(),
            resourceId: contact.resourceId,
            contactLinkId: contact.contactLinkId,
            contactEndpointId: contact.contactEndpointId,
            contactorPhoneNumber: encryptPhoneNumber(plainVisitor),
            type,
            status: "PENDING",
            visitId: visitId || null,
        },
    })
    return session;
  
    }

    catch(err){
        console.error("createCommunicationSession error:", err);
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
                            id: true,
                            mobileNumber: true,
                            contactEndpoint: {
                                select: {
                                    id: true,
                                    phoneNumber: true,
                                    phoneEncrypted: true,
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

    const user = contactLink.resource.user;
    let contactEndpoint = user?.contactEndpoint;

    // Resilient fallback: If contactEndpoint row is missing, check user's mobileNumber
    const rawOwnerPhone =
        contactEndpoint?.phoneEncrypted ||
        contactEndpoint?.phoneNumber ||
        user?.mobileNumber;

    if (!rawOwnerPhone) {
        throw new InternalError(
            "Contact endpoint not configured"
        );
    }

    const decryptedOwnerPhone = decryptPhoneNumber(rawOwnerPhone);

    // If contactEndpoint record was missing for this user, auto-create it now
    let contactEndpointId = contactEndpoint?.id;
    if (!contactEndpointId && user?.id) {
        const createdEp = await prisma.contactEndpoint.create({
            data: {
                userId: user.id,
                type: "PHONE",
                phoneNumber: isEncrypted(rawOwnerPhone) ? rawOwnerPhone : encryptPhoneNumber(rawOwnerPhone),
                phoneEncrypted: isEncrypted(rawOwnerPhone) ? rawOwnerPhone : encryptPhoneNumber(rawOwnerPhone),
                phoneLookup: generatePhoneLookup(decryptedOwnerPhone),
            },
        });
        contactEndpointId = createdEp.id;
    }

    if (!contactEndpointId) {
        throw new InternalError("Could not resolve contact endpoint ID");
    }

    return {
        contactLinkId: contactLink.id,
        resourceId: contactLink.resourceId,
        contactEndpointId,
        contactEndpointPhoneNumber: decryptedOwnerPhone,
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

    const plainRegNo = decryptData(existingRegNo);
    const cleanExisting = plainRegNo.replace(/[\s\-]/g, "").toUpperCase();
    const cleanSubmitted = submittedRegNo.replace(/[\s\-]/g, "").toUpperCase();

    if (cleanExisting !== cleanSubmitted) {
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