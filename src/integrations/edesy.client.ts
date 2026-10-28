interface EdesyInitiateCallResponse {
  data: {
    call_sid: string;
    status: string;
    party_a: string;
    party_b: string;
    masked_number: string;
  };
}

import { AppError } from "../errors/AppError.js";
import { isEncrypted, decryptPhoneNumber } from "../utils/data-protection.js";

export class EdesyApiError extends AppError {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code?: string
  ) {
    super(message, statusCode >= 400 && statusCode < 600 ? statusCode : 502);
    this.name = "EdesyApiError";
  }
}

export class EdesyClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor() {
    this.baseUrl = process.env.EDESY_BASE_URL!;
    this.apiKey = process.env.EDESY_API_KEY!;
  }

  async initiateCall(
    partyA: string,
    partyB: string,
    reference?: string
  ): Promise<EdesyInitiateCallResponse> {
    // Edesy will not accept encrypted phone numbers; ensure both parties are decrypted plaintext
    let cleanPartyA = partyA ? partyA.trim() : "";
    let cleanPartyB = partyB ? partyB.trim() : "";

    if (isEncrypted(cleanPartyA)) {
      cleanPartyA = decryptPhoneNumber(cleanPartyA);
    }
    if (isEncrypted(cleanPartyB)) {
      cleanPartyB = decryptPhoneNumber(cleanPartyB);
    }

    // Strip extraneous punctuation while preserving digits and country code prefix
    cleanPartyA = cleanPartyA.replace(/[\s\-()]/g, "");
    cleanPartyB = cleanPartyB.replace(/[\s\-()]/g, "");

    // Fail-safe security check: never dispatch ciphertext to external telephony provider
    if (isEncrypted(cleanPartyA) || cleanPartyA.includes(":")) {
      throw new EdesyApiError(
        "Invalid party_a: Phone number is encrypted and could not be decrypted before provider dispatch",
        400
      );
    }
    if (isEncrypted(cleanPartyB) || cleanPartyB.includes(":")) {
      throw new EdesyApiError(
        "Invalid party_b: Phone number is encrypted and could not be decrypted before provider dispatch",
        400
      );
    }

    const payload: Record<string, any> = {
      party_a: cleanPartyA,
      party_b: cleanPartyB,
    };
    if (reference) {
      payload.reference = reference;
    }

    const response = await fetch(
      `${this.baseUrl}/v1/masking/calls`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      }
    );

    const body = await response.json();

    if (!response.ok) {
      console.error("Edesy API error response:", { status: response.status, body });
      throw new EdesyApiError(
        body?.error?.message ?? "Edesy API request failed",
        response.status,
        body?.error?.code
      );
    }

    return body as EdesyInitiateCallResponse;
  }
}

export const edesyClient = new EdesyClient();