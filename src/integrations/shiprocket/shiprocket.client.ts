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

export interface ShiprocketServiceabilityInput {
  pickupPostcode: string;
  deliveryPostcode: string;
  weightKg: number;
  cod: boolean;
  lengthCm?: number | undefined;
  breadthCm?: number | undefined;
  heightCm?: number | undefined;
  declaredValue?: number | undefined;
}

export interface ShiprocketAvailableCourier {
  courierCompanyId: number;
  courierName: string;
  rate: number; // in Rupees
  cod: number;
  codCharges?: number | undefined;
  estimatedDeliveryDays?: string | undefined;
  etd?: string | null | undefined;
  rating?: number | undefined;
}

export interface ShiprocketServiceabilityResult {
  isServiceable: boolean;
  availableCouriers: ShiprocketAvailableCourier[];
  cheapestCourier?: ShiprocketAvailableCourier | undefined;
  rawResponse?: any;
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
   * STRICT SAFETY GUARD: Live shipment order creation is blocked unless SHIPROCKET_ENABLE_LIVE_ORDERS is explicitly "true".
   */
  public async createOrder(input: ShiprocketCreateOrderInput): Promise<{
    orderId: string;
    shipmentId: string;
  }> {
    if (process.env.SHIPROCKET_ENABLE_LIVE_ORDERS !== "true") {
      const simOrderId = `SIM-SR-${Date.now()}`;
      const simShipmentId = `SIM-SHP-${Date.now()}`;
      return { orderId: simOrderId, shipmentId: simShipmentId };
    }

    const token = await this.getToken();
    if (!token) {
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
   * STRICT SAFETY GUARD: Live AWB booking is blocked unless SHIPROCKET_ENABLE_LIVE_ORDERS is explicitly "true".
   */
  public async assignAwb(shipmentId: string): Promise<{
    awbCode: string;
    courierName: string;
  }> {
    if (process.env.SHIPROCKET_ENABLE_LIVE_ORDERS !== "true") {
      const simAwb = `AWB${Date.now().toString().slice(-9)}`;
      return {
        awbCode: simAwb,
        courierName: "Delhivery (Simulated)",
      };
    }

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

  /**
   * Checks courier serviceability and shipping rates from Shiprocket.
   */
  public async getCourierServiceability(
    input: ShiprocketServiceabilityInput
  ): Promise<ShiprocketServiceabilityResult> {
    const cacheKey = `shiprocket:rates:${input.pickupPostcode}:${input.deliveryPostcode}:${input.weightKg.toFixed(2)}:${input.cod ? 1 : 0}:${Math.round(input.lengthCm || 0)}x${Math.round(input.breadthCm || 0)}x${Math.round(input.heightCm || 0)}`;

    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached) as ShiprocketServiceabilityResult;
      }
    } catch (err) {
      console.warn("Failed to read Shiprocket rate cache from Redis:", err);
    }

    const token = await this.getToken();

    if (!token) {
      // Realistic simulated fallback for environments without credentials
      const isPincodeValid = /^[1-9][0-9]{5}$/.test(input.deliveryPostcode);
      if (!isPincodeValid || input.deliveryPostcode === "999999") {
        return {
          isServiceable: false,
          availableCouriers: [],
        };
      }

      const simulatedCouriers: ShiprocketAvailableCourier[] = [
        {
          courierCompanyId: 3,
          courierName: "Delhivery Surface",
          rate: 49.0,
          cod: 1,
          codCharges: 25.0,
          estimatedDeliveryDays: "3-4 days",
          etd: new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString().split("T")[0],
          rating: 4.2,
        },
        {
          courierCompanyId: 1,
          courierName: "Blue Dart Air",
          rate: 79.0,
          cod: 1,
          codCharges: 30.0,
          estimatedDeliveryDays: "1-2 days",
          etd: new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString().split("T")[0],
          rating: 4.7,
        },
      ];

      const result: ShiprocketServiceabilityResult = {
        isServiceable: true,
        availableCouriers: simulatedCouriers,
        cheapestCourier: simulatedCouriers[0],
      };

      try {
        await redis.set(cacheKey, JSON.stringify(result), "EX", 900); // 15 mins cache
      } catch (err) {
        console.warn("Failed to cache Shiprocket rates in Redis:", err);
      }

      return result;
    }

    const queryParams = new URLSearchParams({
      pickup_postcode: input.pickupPostcode,
      delivery_postcode: input.deliveryPostcode,
      weight: String(Math.max(0.01, input.weightKg)),
      cod: input.cod ? "1" : "0",
    });

    if (input.lengthCm) queryParams.set("length", String(Math.max(1, Math.round(input.lengthCm))));
    if (input.breadthCm) queryParams.set("breadth", String(Math.max(1, Math.round(input.breadthCm))));
    if (input.heightCm) queryParams.set("height", String(Math.max(1, Math.round(input.heightCm))));
    if (input.declaredValue) queryParams.set("declared_value", String(Math.round(input.declaredValue)));

    const surfaceParams = new URLSearchParams(queryParams);
    surfaceParams.set("mode", "surface");

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    try {
      // Query both standard (all modes) and explicit surface mode concurrently to guarantee surface couriers are never suppressed
      const [resAll, resSurface] = await Promise.allSettled([
        fetch(`${this.baseUrl}/courier/serviceability/?${queryParams.toString()}`, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          signal: controller.signal,
        }),
        fetch(`${this.baseUrl}/courier/serviceability/?${surfaceParams.toString()}`, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          signal: controller.signal,
        }),
      ]);

      clearTimeout(timeoutId);

      const rawCouriersMap = new Map<number, any>();

      if (resAll.status === "fulfilled" && resAll.value.ok) {
        const body = (await resAll.value.json()) as any;
        const list = body?.data?.available_courier_companies;
        if (Array.isArray(list)) {
          for (const c of list) {
            if (c?.courier_company_id) rawCouriersMap.set(Number(c.courier_company_id), c);
          }
        }
      }

      if (resSurface.status === "fulfilled" && resSurface.value.ok) {
        const body = (await resSurface.value.json()) as any;
        const list = body?.data?.available_courier_companies;
        if (Array.isArray(list)) {
          for (const c of list) {
            if (c?.courier_company_id && !rawCouriersMap.has(Number(c.courier_company_id))) {
              rawCouriersMap.set(Number(c.courier_company_id), c);
            }
          }
        }
      }

      const rawCouriers = Array.from(rawCouriersMap.values());

      if (rawCouriers.length === 0) {
        return {
          isServiceable: false,
          availableCouriers: [],
        };
      }

      const parsedCouriers: ShiprocketAvailableCourier[] = rawCouriers
        .filter((c: any) => {
          if (!c || typeof c.rate !== "number" || c.rate <= 0) return false;
          if (input.cod && c.cod !== 1) return false;
          return true;
        })
        .map((c: any) => ({
          courierCompanyId: Number(c.courier_company_id),
          courierName: String(c.courier_name || "Express Courier"),
          rate: Number(c.rate),
          cod: Number(c.cod || 0),
          codCharges: c.cod_charges !== undefined ? Number(c.cod_charges) : undefined,
          estimatedDeliveryDays: c.estimated_delivery_days ? String(c.estimated_delivery_days) : undefined,
          etd: c.etd ? String(c.etd) : null,
          rating: c.rating !== undefined ? Number(c.rating) : undefined,
        }));

      if (parsedCouriers.length === 0) {
        return {
          isServiceable: false,
          availableCouriers: [],
        };
      }

      // Sort by rate ascending to reliably pick the cheapest courier
      parsedCouriers.sort((a, b) => a.rate - b.rate);

      const result: ShiprocketServiceabilityResult = {
        isServiceable: true,
        availableCouriers: parsedCouriers,
        cheapestCourier: parsedCouriers[0],
      };

      try {
        await redis.set(cacheKey, JSON.stringify(result), "EX", 900); // 15 mins cache
      } catch (err) {
        console.warn("Failed to cache Shiprocket rates in Redis:", err);
      }

      return result;
    } catch (err: any) {
      clearTimeout(timeoutId);
      console.error("Shiprocket courier serviceability request failed:", err?.message || err);
      return {
        isServiceable: false,
        availableCouriers: [],
      };
    }
  }
}

export const shiprocketClient = new ShiprocketClient();
