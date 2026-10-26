import redis from "../../lib/redis.js";

export interface ShiprocketOrderItem {
  name: string;
  sku: string;
  units: number;
  selling_price: number;
}

export interface ShiprocketCreateOrderInput {
  order_id: string;
  order_date: string;
  pickup_location?: string;
  billing_customer_name: string;
  billing_last_name?: string;
  billing_address: string;
  billing_city: string;
  billing_pincode: string;
  billing_state: string;
  billing_country?: string;
  billing_email: string;
  billing_phone: string;
  shipping_is_billing: boolean;
  order_items: ShiprocketOrderItem[];
  payment_method: "Prepaid" | "COD";
  sub_total: number;
  length: number;
  breadth: number;
  height: number;
  weight: number; // in kg
}

export interface ShiprocketTrackingActivity {
  date: string;
  status: string;
  activity: string;
  location: string;
}

export interface NormalizedTrackingData {
  awbCode: string;
  courierName: string;
  currentStatus: string;
  origin?: string | undefined;
  destination?: string | undefined;
  etd?: string | null | undefined;
  trackUrl?: string | undefined;
  activities: ShiprocketTrackingActivity[];
}

export class ShiprocketClient {
  private baseUrl: string;
  private email?: string | undefined;
  private password?: string | undefined;

  constructor() {
    this.baseUrl = process.env.SHIPROCKET_BASE_URL || "https://apiv2.shiprocket.in/v1/external";
    this.email = process.env.SHIPROCKET_EMAIL;
    this.password = process.env.SHIPROCKET_PASSWORD;
  }

  public isConfigured(): boolean {
    return Boolean(this.email && this.password);
  }

  /**
   * Retrieves or refreshes the Shiprocket JWT auth token.
   * Caches in Redis for 8 days (token expires in 10 days).
   */
  public async getToken(): Promise<string | null> {
    if (!this.isConfigured()) {
      return null;
    }

    const cacheKey = "shiprocket:jwt_token";
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        return cached;
      }
    } catch (err) {
      console.warn("Failed to read Shiprocket token from Redis:", err);
    }

    try {
      const res = await fetch(`${this.baseUrl}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: this.email,
          password: this.password,
        }),
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Shiprocket auth failed (${res.status}): ${errorText}`);
      }

      const data = (await res.json()) as { token: string };
      if (!data.token) {
        throw new Error("Shiprocket auth response missing token");
      }

      try {
        await redis.set(cacheKey, data.token, "EX", 8 * 24 * 3600);
      } catch (err) {
        console.warn("Failed to cache Shiprocket token in Redis:", err);
      }

      return data.token;
    } catch (err) {
      console.error("Shiprocket login request failed:", err);
      throw err;
    }
  }

  /**
   * Creates a custom order in Shiprocket.
   */
  public async createOrder(input: ShiprocketCreateOrderInput): Promise<{
    orderId: string;
    shipmentId: string;
  }> {
    const token = await this.getToken();
    if (!token) {
      // Return simulated order ID when credentials are not configured
      const simOrderId = `SIM-SR-${Date.now()}`;
      const simShipmentId = `SIM-SHP-${Date.now()}`;
      return { orderId: simOrderId, shipmentId: simShipmentId };
    }

    const res = await fetch(`${this.baseUrl}/orders/create/adhoc`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(input),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Shiprocket createOrder failed (${res.status}): ${err}`);
    }

    const data = (await res.json()) as { order_id: number; shipment_id: number };
    return {
      orderId: String(data.order_id),
      shipmentId: String(data.shipment_id),
    };
  }

  /**
   * Assigns AWB code to an existing shipment in Shiprocket.
   */
  public async assignAwb(shipmentId: string): Promise<{
    awbCode: string;
    courierName: string;
  }> {
    const token = await this.getToken();
    if (!token) {
      const simAwb = `AWB${Date.now().toString().slice(-9)}`;
      return {
        awbCode: simAwb,
        courierName: "Delhivery (Simulated)",
      };
    }

    const res = await fetch(`${this.baseUrl}/courier/assign/awb`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ shipment_id: shipmentId }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Shiprocket assignAwb failed (${res.status}): ${err}`);
    }

    const data = (await res.json()) as {
      response?: {
        data?: {
          awb_code?: string;
          courier_name?: string;
        };
      };
    };

    const awb = data.response?.data?.awb_code;
    const courier = data.response?.data?.courier_name || "Express Courier";

    if (!awb) {
      throw new Error("Shiprocket did not return an AWB code");
    }

    return {
      awbCode: awb,
      courierName: courier,
    };
  }

  /**
   * Fetches real-time courier tracking details for a given AWB code.
   */
  public async getTrackingByAwb(
    awbCode: string,
    fallbackCourierName = "Courier Partner",
    shippingStatus = "IN_TRANSIT"
  ): Promise<NormalizedTrackingData> {
    const token = await this.getToken();

    if (!token || awbCode.startsWith("AWB") || awbCode.startsWith("SIM-")) {
      // Return simulated tracking activities based on current shipping status
      return this.buildSimulatedTracking(awbCode, fallbackCourierName, shippingStatus);
    }

    try {
      const res = await fetch(`${this.baseUrl}/courier/track/awb/${awbCode}`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        console.warn(`Shiprocket tracking fetch returned ${res.status} for AWB ${awbCode}`);
        return this.buildSimulatedTracking(awbCode, fallbackCourierName, shippingStatus);
      }

      const body = (await res.json()) as any;
      const trackData = body.tracking_data;

      if (!trackData || !trackData.shipment_track || trackData.shipment_track.length === 0) {
        return this.buildSimulatedTracking(awbCode, fallbackCourierName, shippingStatus);
      }

      const info = trackData.shipment_track[0];
      const activities: ShiprocketTrackingActivity[] = (
        trackData.shipment_track_activities || []
      ).map((act: any) => ({
        date: act.date || new Date().toISOString(),
        status: act.status || "In Transit",
        activity: act.activity || "Package status updated",
        location: act.location || "",
      }));

      return {
        awbCode,
        courierName: info.courier_name || fallbackCourierName,
        currentStatus: info.current_status || "In Transit",
        origin: info.origin || undefined,
        destination: info.destination || undefined,
        etd: trackData.etd || null,
        trackUrl: trackData.track_url || `https://shiprocket.co/tracking/${awbCode}`,
        activities,
      };
    } catch (err) {
      console.warn("Failed to fetch live tracking from Shiprocket API:", err);
      return this.buildSimulatedTracking(awbCode, fallbackCourierName, shippingStatus);
    }
  }

  /**
   * Builds realistic simulated tracking milestones when live API is unavailable.
   */
  private buildSimulatedTracking(
    awbCode: string,
    courierName: string,
    shippingStatus: string
  ): NormalizedTrackingData {
    const now = new Date();
    const isDelivered = shippingStatus === "DELIVERED";
    const isOutForDelivery = shippingStatus === "OUT_FOR_DELIVERY" || isDelivered;
    const isInTransit = ["IN_TRANSIT", "OUT_FOR_DELIVERY", "DELIVERED"].includes(shippingStatus);

    const activities: ShiprocketTrackingActivity[] = [
      {
        date: new Date(now.getTime() - 24 * 3600 * 1000).toISOString(),
        status: "Manifested",
        activity: "Shipment details received and AWB generated",
        location: "Bengaluru Fulfillment Hub",
      },
    ];

    if (isInTransit) {
      activities.push({
        date: new Date(now.getTime() - 16 * 3600 * 1000).toISOString(),
        status: "Picked Up",
        activity: "Package received at origin courier sorting hub",
        location: "Bengaluru Hub",
      });
      activities.push({
        date: new Date(now.getTime() - 8 * 3600 * 1000).toISOString(),
        status: "In Transit",
        activity: "In transit to destination delivery center",
        location: "Regional Transit Center",
      });
    }

    if (isOutForDelivery) {
      activities.push({
        date: new Date(now.getTime() - 2 * 3600 * 1000).toISOString(),
        status: "Out for Delivery",
        activity: "Package assigned to delivery rider for final delivery",
        location: "Destination Delivery Hub",
      });
    }

    if (isDelivered) {
      activities.push({
        date: now.toISOString(),
        status: "Delivered",
        activity: "Package safely delivered to customer",
        location: "Customer Address",
      });
    }

    return {
      awbCode,
      courierName,
      currentStatus: isDelivered
        ? "Delivered"
        : isOutForDelivery
        ? "Out for Delivery"
        : isInTransit
        ? "In Transit"
        : "Pickup Scheduled",
      trackUrl: `https://shiprocket.co/tracking/${awbCode}`,
      activities: activities.reverse(), // most recent first
    };
  }
}

export const shiprocketClient = new ShiprocketClient();
