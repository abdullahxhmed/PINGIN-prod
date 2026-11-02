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
    reference?: string,
    maxDurationSeconds: number = 590 // Hard cutoff strictly below 10 minutes (600s)
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

    // Format to strict 10-digit Indian mobile numbers as required by Edesy
    const to10DigitIndianNumber = (phone: string): string => {
      const digits = phone.replace(/\D/g, "");
      if (digits.length === 12 && digits.startsWith("91")) {
        return digits.slice(2);
      }
      if (digits.length === 11 && digits.startsWith("0")) {
        return digits.slice(1);
      }
      if (digits.length > 10) {
        return digits.slice(-10);
      }
      return digits;
    };

    cleanPartyA = to10DigitIndianNumber(cleanPartyA);
    cleanPartyB = to10DigitIndianNumber(cleanPartyB);

    if (cleanPartyA.length !== 10) {
      throw new EdesyApiError(
        `Invalid party_a: Must be a 10-digit Indian mobile number (got ${cleanPartyA.length} digits)`,
        400
      );
    }
    if (cleanPartyB.length !== 10) {
      throw new EdesyApiError(
        `Invalid party_b: Must be a 10-digit Indian mobile number (got ${cleanPartyB.length} digits)`,
        400
      );
    }

    // Clamp duration between 10 and 7200 seconds per Edesy specification
    const clampedDuration = Math.min(7200, Math.max(10, Math.round(maxDurationSeconds)));

    const payload: Record<string, any> = {
      party_a: cleanPartyA,
      party_b: cleanPartyB,
      max_duration_sec: clampedDuration,
    };
    if (reference) {
      payload.reference = reference;
    }

    const cleanBaseUrl = this.baseUrl.replace(/\/+$/, "");
    const url = cleanBaseUrl.endsWith("/v1")
      ? `${cleanBaseUrl}/masking/calls`
      : `${cleanBaseUrl}/v1/masking/calls`;

    const response = await fetch(
      url,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      }
    );

    let body: any = null;
    const rawText = await response.text();
    try {
      body = JSON.parse(rawText);
    } catch {
      body = { message: rawText };
    }

    if (!response.ok) {
      console.error("Edesy API error response:", { status: response.status, body });
      const errorMessage =
        body?.error?.message ??
        body?.message ??
        (typeof body === "string" ? body : "Edesy API request failed");

      throw new EdesyApiError(
        errorMessage,
        response.status,
        body?.error?.code
      );
    }

    return body as EdesyInitiateCallResponse;
  }
}

export const edesyClient = new EdesyClient();