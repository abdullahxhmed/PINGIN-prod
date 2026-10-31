export interface TelephonyPricing {
  provider: string;
  ratePerMinutePaise: number;
  billingIncrementSeconds: number;
  minimumBillableSeconds: number;
  gstRate: number; // e.g. 18 for 18% GST
}

export const TELEPHONY_PROVIDERS: Record<string, TelephonyPricing> = {
  EDESY: {
    provider: "EDESY",
    ratePerMinutePaise: 150, // ₹1.50 / min
    billingIncrementSeconds: 60, // 60-second pulse
    minimumBillableSeconds: 60, // 60-second minimum for connected calls
    gstRate: 18, // 18% GST on telephony services
  },
};

export const getTelephonyPricing = (provider: string = "EDESY"): TelephonyPricing => {
  const normalized = provider.toUpperCase().trim();
  return (
    TELEPHONY_PROVIDERS[normalized] || {
      provider: normalized,
      ratePerMinutePaise: 150,
      billingIncrementSeconds: 60,
      minimumBillableSeconds: 60,
      gstRate: 18,
    }
  );
};

/**
 * Calculates billed duration in seconds based on actual connected seconds and provider pulse.
 * - Non-connected calls (unanswered, failed, cancelled) have 0 billed seconds.
 * - Connected calls are rounded up according to billingIncrementSeconds and minimumBillableSeconds.
 */
export const calculateBilledDurationSeconds = (
  actualDurationSeconds: number,
  provider: string = "EDESY",
  isConnected: boolean = true
): number => {
  if (!isConnected || actualDurationSeconds <= 0) {
    return 0;
  }
  const config = getTelephonyPricing(provider);
  const increment = config.billingIncrementSeconds > 0 ? config.billingIncrementSeconds : 60;
  const minimum = config.minimumBillableSeconds > 0 ? config.minimumBillableSeconds : increment;

  const rawRounded = Math.ceil(actualDurationSeconds / increment) * increment;
  return Math.max(minimum, rawRounded);
};

/**
 * Calculates estimated cost in paise from billed duration including GST.
 */
export const calculateEstimatedCostPaise = (
  billedDurationSeconds: number,
  provider: string = "EDESY"
): number => {
  if (billedDurationSeconds <= 0) {
    return 0;
  }
  const config = getTelephonyPricing(provider);
  const billedMinutes = Math.ceil(billedDurationSeconds / 60);
  const baseCostPaise = billedMinutes * config.ratePerMinutePaise;
  const gstCostPaise = Math.round(baseCostPaise * (config.gstRate / 100));
  return baseCostPaise + gstCostPaise;
};

/**
 * Never calculate a final cost from estimated duration if the provider supplies an actual billing amount.
 */
export const resolveEffectiveCostPaise = (call: {
  providerCostPaise?: number | null;
  estimatedCostPaise?: number | null;
  billedDurationSeconds?: number;
  provider?: string;
}): number => {
  if (call.providerCostPaise != null) {
    return call.providerCostPaise;
  }
  if (call.estimatedCostPaise != null) {
    return call.estimatedCostPaise;
  }
  return calculateEstimatedCostPaise(call.billedDurationSeconds ?? 0, call.provider);
};

