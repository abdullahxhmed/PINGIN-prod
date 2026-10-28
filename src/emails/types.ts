export interface MailConfig {
  host?: string | undefined;
  port?: number | undefined;
  secure?: boolean | undefined;
  service?: string | undefined;
  user?: string | undefined;
  pass?: string | undefined;
  from: string;
  adminEmail: string;
}

export interface SendMailOptions {
  to?: string | string[] | undefined;
  subject: string;
  text?: string | undefined;
  html?: string | undefined;
  replyTo?: string | undefined;
}

export interface SendMailResult {
  success: boolean;
  messageId?: string | undefined;
  error?: string | undefined;
  skipped?: boolean | undefined;
}

export interface AdminOrderEmailItem {
  variantName: string;
  sku?: string | undefined;
  imageUrl?: string | undefined;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

export interface AdminOrderEmailAddress {
  fullName: string;
  phoneNumber: string;
  addressLine1: string;
  addressLine2?: string | null | undefined;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

export interface AdminOrderCreatedEmailData {
  orderNumber: string;
  orderId: string;
  status: string;
  totalAmount: number;
  currency: string;
  customerEmail?: string | null | undefined;
  customerPhone?: string | null | undefined;
  shippingAddress: AdminOrderEmailAddress;
  items: AdminOrderEmailItem[];
  createdAt?: Date | string | undefined;
  razorpayOrderId?: string | null | undefined;
}

export interface AdminOrderPaidEmailData {
  orderNumber: string;
  orderId: string;
  totalAmount: number;
  currency: string;
  customerEmail?: string | null | undefined;
  customerPhone?: string | null | undefined;
  providerPaymentId: string;
  paidAt?: Date | string | undefined;
  shippingAddress?: AdminOrderEmailAddress | undefined;
  items?: AdminOrderEmailItem[] | undefined;
}

export type StockAlertSeverity = "LOW_STOCK" | "OUT_OF_STOCK" | "CRITICAL";

export interface StockAlertData {
  sku: string;
  name: string;
  imageUrl?: string | undefined;
  quantityOnHand: number;
  reservedCount?: number | undefined;
  availableCount: number;
  reorderLevel: number;
  severity: StockAlertSeverity;
  triggeredBy?: string | undefined;
  timestamp?: Date | string | undefined;
}

export interface AdminCustomNotificationData {
  subject: string;
  title: string;
  message: string;
  severity?: "INFO" | "WARNING" | "CRITICAL" | undefined;
  details?: Record<string, any> | undefined;
  timestamp?: Date | string | undefined;
}

