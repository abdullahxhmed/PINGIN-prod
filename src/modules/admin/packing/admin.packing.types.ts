import { OrderStatus, PackingSessionStatus } from "@prisma/client";

export interface SkuRequirementProgress {
  sku: string;
  name: string;
  required: number;
  scanned: number;
  remaining: number;
  imageUrl?: string | null;
  imageReference?: string | null;
}

export interface PackingProgressSummary {
  orderId: string;
  orderNumber: string;
  orderStatus: OrderStatus;
  activeSessionId: string | null;
  sessionStatus: PackingSessionStatus | null;
  sessionNumber: number | null;
  packedBy: string | null;
  totalRequired: number;
  totalScanned: number;
  isComplete: boolean;
  skuProgress: SkuRequirementProgress[];
  scannedTags: Array<{
    tagNumber: string;
    sku: string;
    scannedAt: Date;
    orderItemId: string;
  }>;
}

export interface ScanTagResult {
  success: boolean;
  alreadyScanned: boolean;
  scannedTagNumber: string;
  sku: string;
  orderItemId: string;
  progress: PackingProgressSummary;
}
