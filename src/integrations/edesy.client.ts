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
    partyB: string
  ): Promise<EdesyInitiateCallResponse> {
    const response = await fetch(
      `${this.baseUrl}/v1/masking/calls`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          party_a: partyA,
          party_b: partyB,
        }),
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