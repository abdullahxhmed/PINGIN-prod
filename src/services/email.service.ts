import * as React from "react";
import { render } from "@react-email/render";
import {
  getMailerConfig,
  getMailerTransporter,
  isMailerConfigured,
  verifyMailerConnection,
} from "../config/mailer.js";
import { logger } from "../lib/logger.js";
import { prisma } from "../lib/prisma.js";
import { getPublicImageUrl } from "../modules/catalog/catalog-images.service.js";
import {
  OrderConfirmation,
  type OrderConfirmationProps,
  type EmailOrderItem,
} from "../emails/templates/OrderConfirmation.js";
import { StockAlert, type StockAlertProps } from "../emails/templates/StockAlert.js";
import { ShippingUpdate, type ShippingUpdateProps } from "../emails/templates/ShippingUpdate.js";
import type {
  AdminOrderCreatedEmailData,
  AdminOrderPaidEmailData,
  StockAlertData,
} from "../emails/types.js";

export interface SendEmailOptions {
  to?: string | string[] | undefined;
  subject: string;
  html?: string | undefined;
  text?: string | undefined;
}

export interface EmailResult {
  success: boolean;
  messageId?: string | undefined;
  skipped?: boolean | undefined;
  error?: string | undefined;
}

// In-memory cooldown cache to avoid spamming the admin for the same low-stock SKU
const stockAlertCache = new Map<string, { lastAlertedAt: number; lastAvailableCount: number }>();
const STOCK_ALERT_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

export class EmailService {
  /**
   * Verifies the SMTP connection.
   */
  async verifyConnection(): Promise<{ ready: boolean; error?: string | undefined }> {
    return await verifyMailerConnection();
  }

  /**
   * Alias for sendEmail for API compatibility.
   */
  async sendMail(options: SendEmailOptions): Promise<EmailResult> {
    return await this.sendEmail(options);
  }

  /**
   * Core sendEmail method.
   * Sends directly to the configured ADMIN_EMAIL if `to` is not supplied.
   */
  async sendEmail(options: SendEmailOptions): Promise<EmailResult> {
    const config = getMailerConfig();

    if (!isMailerConfigured()) {
      logger.warn(
        { subject: options.subject },
        "EmailService: SMTP credentials not set. Skipping email delivery."
      );
      return {
        success: false,
        skipped: true,
        error: "SMTP not configured",
      };
    }

    const transporter = getMailerTransporter();
    if (!transporter) {
      logger.error("EmailService: No transporter instance available.");
      return { success: false, error: "No transporter instance" };
    }

    const recipients = options.to || config.adminEmail;

    try {
      const info = await transporter.sendMail({
        from: config.from,
        to: recipients,
        subject: options.subject,
        html: options.html,
        text: options.text,
      });

      logger.info(
        { messageId: info.messageId, recipients, subject: options.subject },
        "EmailService: Email delivered successfully."
      );

      return {
        success: true,
        messageId: info.messageId,
      };
    } catch (err: any) {
      logger.error(
        { err: err?.message || err, recipients, subject: options.subject },
        "EmailService: Delivery error."
      );
      return {
        success: false,
        error: err?.message || "Delivery error",
      };
    }
  }

  /**
   * Sends Kauntact OrderConfirmation email to the admin using React Email.
   */
  async sendOrderConfirmation(props: OrderConfirmationProps): Promise<EmailResult> {
    try {
      const element = React.createElement(OrderConfirmation, props);
      const html = await render(element);
      const text = await render(element, { plainText: true });

      const priceStr = `₹${(props.totalAmountPaise / 100).toLocaleString("en-IN")}`;
      const subject = `[Kauntact] 🛒 Order #${props.orderNumber} - ${priceStr} (${props.payment.status})`;

      return await this.sendEmail({
        subject,
        html,
        text,
      });
    } catch (err: any) {
      logger.error(
        { err, orderNumber: props.orderNumber },
        "EmailService: Failed to render/send OrderConfirmation"
      );
      return { success: false, error: err.message };
    }
  }

  /**
   * Dispatches an order creation email to the admin using OrderConfirmation template.
   */
  async sendOrderCreatedAdminNotification(
    data: AdminOrderCreatedEmailData
  ): Promise<EmailResult> {
    // Database monetary amounts are stored in paise (e.g. 149900 = ₹1,499)
    const totalPaise = Math.round(data.totalAmount);

    const emailItems: EmailOrderItem[] = data.items.map((i, idx) => ({
      id: `item-${idx + 1}`,
      name: i.variantName,
      sku: i.sku || "SKU-N/A",
      imageUrl: getPublicImageUrl(i.imageUrl) || undefined,
      quantity: i.quantity,
      unitPricePaise: Math.round(i.unitPrice),
      totalPricePaise: Math.round(i.totalPrice),
    }));

    return await this.sendOrderConfirmation({
      orderNumber: data.orderNumber,
      orderId: data.orderId,
      orderCreatedAt: data.createdAt
        ? new Date(data.createdAt).toISOString()
        : new Date().toISOString(),
      customer: {
        name: data.shippingAddress.fullName,
        email: data.customerEmail || "N/A",
        phone: data.customerPhone || data.shippingAddress.phoneNumber,
        address: {
          addressLine1: data.shippingAddress.addressLine1,
          addressLine2: data.shippingAddress.addressLine2 ?? undefined,
          city: data.shippingAddress.city,
          state: data.shippingAddress.state,
          postalCode: data.shippingAddress.postalCode,
          country: data.shippingAddress.country,
        },
      },
      payment: {
        status: "PENDING",
        provider: "RAZORPAY",
        razorpayOrderId: data.razorpayOrderId ?? undefined,
        method: "Online",
      },
      items: emailItems,
      subtotalPaise: totalPaise,
      shippingFeePaise: 0,
      totalAmountPaise: totalPaise,
      adminConsoleBaseUrl: process.env.PUBLIC_APP_URL || "https://kauntact.in",
    });
  }

  /**
   * Dispatches an order paid confirmation email to the admin using OrderConfirmation template.
   * Fired exclusively upon successful payment capture.
   */
  async sendOrderPaidAdminNotification(
    data: AdminOrderPaidEmailData
  ): Promise<EmailResult> {
    // Database monetary amounts are stored in paise (e.g. 149900 = ₹1,499)
    const totalPaise = Math.round(data.totalAmount);

    const emailItems: EmailOrderItem[] = (data.items || []).map((i, idx) => ({
      id: `item-${idx + 1}`,
      name: i.variantName,
      sku: i.sku || "SKU-N/A",
      imageUrl: getPublicImageUrl(i.imageUrl) || undefined,
      quantity: i.quantity,
      unitPricePaise: Math.round(i.unitPrice),
      totalPricePaise: Math.round(i.totalPrice),
    }));

    return await this.sendOrderConfirmation({
      orderNumber: data.orderNumber,
      orderId: data.orderId,
      orderCreatedAt: data.paidAt
        ? new Date(data.paidAt).toISOString()
        : new Date().toISOString(),
      customer: {
        name: data.shippingAddress?.fullName || "Kauntact Customer",
        email: data.customerEmail || "N/A",
        phone: data.customerPhone || data.shippingAddress?.phoneNumber || "N/A",
        address: {
          addressLine1: data.shippingAddress?.addressLine1 || "Address on file",
          addressLine2: data.shippingAddress?.addressLine2 ?? undefined,
          city: data.shippingAddress?.city || "Customer City",
          state: data.shippingAddress?.state || "Customer State",
          postalCode: data.shippingAddress?.postalCode || "000000",
          country: data.shippingAddress?.country || "India",
        },
      },
      payment: {
        status: "CAPTURED",
        provider: "RAZORPAY",
        razorpayPaymentId: data.providerPaymentId,
        razorpaySignatureVerified: true,
        method: "Online",
      },
      items: emailItems,
      subtotalPaise: totalPaise,
      shippingFeePaise: 0,
      totalAmountPaise: totalPaise,
      adminConsoleBaseUrl: process.env.PUBLIC_APP_URL || "https://kauntact.in",
    });
  }

  /**
   * Dispatches a low stock / out of stock alert email to the admin using StockAlert template.
   */
  async sendStockAlertEmail(alert: StockAlertData): Promise<EmailResult> {
    try {
      const isOut = alert.severity === "OUT_OF_STOCK" || alert.availableCount <= 0;
      const subject = isOut
        ? `[Kauntact Alert] 🚨 OUT OF STOCK: ${alert.sku} (${alert.name})`
        : `[Kauntact Alert] ⚠️ Low Stock Alert: ${alert.sku} (${alert.availableCount} left)`;

      const element = React.createElement(StockAlert, {
        ...alert,
        imageUrl: getPublicImageUrl(alert.imageUrl) || undefined,
        adminConsoleBaseUrl: process.env.PUBLIC_APP_URL || "https://kauntact.in",
      });
      const html = await render(element);
      const text = await render(element, { plainText: true });

      return await this.sendEmail({
        subject,
        html,
        text,
      });
    } catch (err: any) {
      logger.error({ err, sku: alert.sku }, "EmailService: Failed to render/send StockAlert");
      return { success: false, error: err.message };
    }
  }

  /**
   * Sends shipping / dispatch update notification.
   */
  async sendShippingUpdateNotification(props: ShippingUpdateProps): Promise<EmailResult> {
    try {
      const element = React.createElement(ShippingUpdate, props);
      const html = await render(element);
      const text = await render(element, { plainText: true });

      return await this.sendEmail({
        subject: `[Kauntact] 🚚 Order #${props.orderNumber} Dispatched (AWB: ${props.awbCode})`,
        html,
        text,
      });
    } catch (err: any) {
      logger.error({ err }, "EmailService: Failed to render/send ShippingUpdate");
      return { success: false, error: err.message };
    }
  }

  /**
   * Inspects database stock against reorder thresholds and alerts the admin.
   */
  async checkAndAlertLowStock(options?: {
    skus?: string[] | undefined;
    triggeredBy?: string | undefined;
    bypassCooldown?: boolean | undefined;
  }): Promise<StockAlertData[]> {
    try {
      const { skus, triggeredBy, bypassCooldown = false } = options || {};

      const stockRecords = await prisma.inventoryStock.findMany({
        ...(skus && skus.length > 0 ? { where: { sku: { in: skus } } } : {}),
      });

      const now = Date.now();
      const alertsToSend: StockAlertData[] = [];

      for (const record of stockRecords) {
        const available = record.quantityOnHand - record.reservedCount;
        const isBelowReorder = available <= record.reorderLevel;

        if (!isBelowReorder) {
          stockAlertCache.delete(record.sku);
          continue;
        }

        const isOut = available <= 0;
        const severity = isOut ? "OUT_OF_STOCK" : "LOW_STOCK";

        const cached = stockAlertCache.get(record.sku);
        const shouldAlert =
          bypassCooldown ||
          !cached ||
          now - cached.lastAlertedAt > STOCK_ALERT_COOLDOWN_MS ||
          available < cached.lastAvailableCount;

        if (shouldAlert) {
          const alertData: StockAlertData = {
            sku: record.sku,
            name: record.name,
            quantityOnHand: record.quantityOnHand,
            reservedCount: record.reservedCount,
            availableCount: available,
            reorderLevel: record.reorderLevel,
            severity,
            triggeredBy,
            timestamp: new Date(),
          };

          alertsToSend.push(alertData);
          stockAlertCache.set(record.sku, {
            lastAlertedAt: now,
            lastAvailableCount: available,
          });
        }
      }

      for (const alert of alertsToSend) {
        this.sendStockAlertEmail(alert).catch((err) => {
          logger.error({ err, sku: alert.sku }, "Background stock alert failed");
        });
      }

      return alertsToSend;
    } catch (err: any) {
      logger.error({ err }, "Error running checkAndAlertLowStock");
      return [];
    }
  }
}

export const emailService = new EmailService();
