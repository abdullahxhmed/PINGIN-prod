import { prisma } from "../../lib/prisma.js";
import { CommunicationSessionType } from "@prisma/client";
import { createCommunicationSession } from "../public-contact/contact.services.js";
import { edesyService } from "../../integrations/edesy.service.js";
import { InternalError } from "../../errors/AppError.js"

interface InitiateCallInput {
  token: string;
  visitorPhoneNumber: string;
}

export const initiateCall = async ({
  token,
  visitorPhoneNumber,
}: InitiateCallInput) => {
  // 1. Create the ParkPing communication session
  const session = await createCommunicationSession(
    token,
    CommunicationSessionType.CALL,
    visitorPhoneNumber,
  );

  // 2. Resolve owner's phone number internally
  const contactEndpoint = await prisma.contactEndpoint.findUnique({
    where: {
      id: session.contactEndpointId,
    },
    select: {
      phoneNumber: true,
    },
  });

  if (!contactEndpoint) {
    throw new InternalError("Contact endpoint not configured");
  }

  // 3. Ask Edesy to initiate the call
  const edesyCall = await edesyService.initiateCall(
    visitorPhoneNumber,
    contactEndpoint.phoneNumber
  );

  // 4. Store the actual provider call
  const communicationCall = await prisma.communicationCall.create({
    data: {
      sessionId: session.id,
      callSid: edesyCall.callSid,
      caller: visitorPhoneNumber,
      callee: contactEndpoint.phoneNumber,
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