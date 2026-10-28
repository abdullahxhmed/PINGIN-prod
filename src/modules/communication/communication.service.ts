import { prisma } from "../../lib/prisma.js";
import { CommunicationSessionType } from "@prisma/client";
import { createCommunicationSession, getCommunicationContact } from "../public-contact/contact.services.js";
import { edesyService } from "../../integrations/edesy.service.js";
import { InternalError, NotFoundError } from "../../errors/AppError.js"
import { checkCallRateLimit } from "../../middleware/call-rateLimiter.js";
import { encryptPhoneNumber, decryptPhoneNumber, isEncrypted } from "../../utils/data-protection.js";


interface InitiateCallInput {
  token: string;
  visitorPhoneNumber: string;
  ip: string;
  visitId?: string;
}

const initiateCall = async ({
  token,
  visitorPhoneNumber,
  ip,
  visitId,
}: InitiateCallInput) => {
    const contact = await getCommunicationContact(token);

    await checkCallRateLimit(
        contact.contactLinkId,
        ip
    );

    // Edesy will not accept encrypted numbers; ensure both sides are plaintext
    const plainVisitorPhone = isEncrypted(visitorPhoneNumber)
      ? decryptPhoneNumber(visitorPhoneNumber)
      : visitorPhoneNumber.trim();

    const plainOwnerPhone = isEncrypted(contact.contactEndpointPhoneNumber)
      ? decryptPhoneNumber(contact.contactEndpointPhoneNumber)
      : contact.contactEndpointPhoneNumber.trim();

    // 1. Create the ParkPing communication session
    const session = await createCommunicationSession(
        token,
        CommunicationSessionType.CALL,
        plainVisitorPhone,
        visitId,
    );

  // 3. Ask Edesy to initiate the call with plaintext numbers
  const edesyCall = await edesyService.initiateCall(
    plainVisitorPhone,
    plainOwnerPhone,
    session.reference
  );

  // 4. Store the actual provider call encrypted at rest
  const communicationCall = await prisma.communicationCall.create({
    data: {
      sessionId: session.id,
      callSid: edesyCall.callSid,
      caller: encryptPhoneNumber(plainVisitorPhone),
      callee: encryptPhoneNumber(plainOwnerPhone),
      direction: "click_to_call",
      status: "INITIATED",
      providerStatus: edesyCall.providerStatus,
    },
  });

  // 5. The session is now active
  await prisma.communicationSession.update({
    where: {
      id: session.id,
    },
    data: {
      status: "ACTIVE",
    },
  });

  return {
    sessionId: session.id,
    callId: communicationCall.id,
    status: communicationCall.status,
  };
};

const getCommunicationCallStatus = async (
    callId: string
) => {
    const call = await prisma.communicationCall.findUnique({
        where: {
            id: callId,
        },
        select: {
            id: true,
            status: true,
            createdAt: true,
            incomingAt: true,
            connectedAt: true,
            endedAt: true,
            durationSec: true,
        },
    });

    if (!call) {
        throw new NotFoundError("Call not found");
    }

    return call;
};


export {
    initiateCall,
    getCommunicationCallStatus
}