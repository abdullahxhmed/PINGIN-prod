import { prisma } from "../../lib/prisma.js";
import { CommunicationSessionType } from "@prisma/client";
import { createCommunicationSession, getCommunicationContact } from "../public-contact/contact.services.js";
import { edesyService } from "../../integrations/edesy.service.js";
import { InternalError, NotFoundError } from "../../errors/AppError.js"
import { checkCallRateLimit } from "../../middleware/call-rateLimiter.js";


interface InitiateCallInput {
  token: string;
  visitorPhoneNumber: string;
  ip:string
}

const initiateCall = async ({
  token,
  visitorPhoneNumber,
  ip
}: InitiateCallInput) => {
    const contact = await getCommunicationContact(token);

    await checkCallRateLimit(
        contact.contactLinkId,
        ip
    );
    // 1. Create the ParkPing communication session
    const session = await createCommunicationSession(
        token,
        CommunicationSessionType.CALL,
        visitorPhoneNumber,
    );

  // 3. Ask Edesy to initiate the call
  const edesyCall = await edesyService.initiateCall(
    visitorPhoneNumber,
    contact.contactEndpointPhoneNumber
  );

  // 4. Store the actual provider call
  const communicationCall = await prisma.communicationCall.create({
    data: {
      sessionId: session.id,
      callSid: edesyCall.callSid,
      caller: visitorPhoneNumber,
      callee: contact.contactEndpointPhoneNumber,
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