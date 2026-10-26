import crypto from "node:crypto";
import { BadRequestError, InternalError } from "../../errors/AppError.js";

export interface RazorpayCreateOrderParams {
  amount: number; // In paise (e.g., 49900 = ₹499)
  currency?: string; // Default: "INR"
  receipt: string; // Internal orderNumber (max 40 chars)
  notes?: Record<string, string>;
}

export interface RazorpayOrderResponse {
  id: string; // e.g. "order_EKwxwAgItmmXdp"
  entity: "order";
  amount: number;
  amount_paid: number;
  amount_due: number;
  currency: string;
  receipt: string;
  status: "created" | "attempted" | "paid";
  attempts: number;
  notes: Record<string, string>;
  created_at: number;
}

export class RazorpayClient {
  private keyId: string;
  private keySecret: string;
  private isMock: boolean;

  constructor() {
    this.keyId = process.env.RAZORPAY_KEY_ID || "";
    this.keySecret = process.env.RAZORPAY_KEY_SECRET || "";
    this.isMock = !this.keyId || !this.keySecret || process.env.RAZORPAY_MOCK === "true";
  }

  public getKeyId(): string {
    return this.keyId || "rzp_mock_key_id";
  }

  public isMockMode(): boolean {
    return this.isMock;
  }

  /**
   * Synchronously creates an order with Razorpay Orders API.
   * Reference: https://razorpay.com/docs/api/orders/create/
   */
  public async createOrder(params: RazorpayCreateOrderParams): Promise<RazorpayOrderResponse> {
    const currency = params.currency || "INR";

    if (this.isMock) {
      // In dev/test when keys are not configured, simulate Razorpay order creation
      const mockOrderId = `order_${crypto.randomBytes(8).toString("hex")}`;
      return {
        id: mockOrderId,
        entity: "order",
        amount: params.amount,
        amount_paid: 0,
        amount_due: params.amount,
        currency,
        receipt: params.receipt,
        status: "created",
        attempts: 0,
        notes: params.notes || {},
        created_at: Math.floor(Date.now() / 1000),
      };
    }

    const authHeader = `Basic ${Buffer.from(`${this.keyId}:${this.keySecret}`).toString("base64")}`;

    const response = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify({
        amount: params.amount,
        currency,
        receipt: params.receipt.substring(0, 40), // Razorpay limits receipt to 40 characters
        notes: params.notes,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      let errorMsg = `Razorpay API error (${response.status})`;
      try {
        const parsed = JSON.parse(errorBody);
        errorMsg = parsed?.error?.description || errorMsg;
      } catch {
        // Fallback to text
      }
      throw new InternalError(`Failed to create Razorpay order: ${errorMsg}`);
    }

    return (await response.json()) as RazorpayOrderResponse;
  }
}

export const razorpayClient = new RazorpayClient();
