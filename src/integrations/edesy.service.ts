import { EdesyClient } from "./edesy.client.js";
import { edesyClient } from "./edesy.client.js";

export interface InitiateCallResult {
  callSid: string;
  providerStatus: string;
  maskedNumber: string;
}

export class EdesyService {
  constructor(private readonly client: EdesyClient) {}

  async initiateCall(
    partyA: string,
    partyB: string
  ): Promise<InitiateCallResult> {
    const response = await this.client.initiateCall(partyA, partyB);

    return {
      callSid: response.data.call_sid,
      providerStatus: response.data.status,
      maskedNumber: response.data.masked_number,
    };
  }
}

export const edesyService = new EdesyService(edesyClient);