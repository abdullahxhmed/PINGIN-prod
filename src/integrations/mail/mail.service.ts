import { emailService } from "../../emails/email.service.js";
import { verifyMailerConnection } from "../../config/mailer.js";
import type {
  AdminCustomNotificationData,
  AdminOrderCreatedEmailData,
  AdminOrderPaidEmailData,
  SendMailOptions,
  SendMailResult,
  StockAlertData,
} from "./mail.types.js";

export class MailService {
  async verifyConnection(): Promise<{ ready: boolean; error?: string | undefined }> {
    return await verifyMailerConnection();
  }

  async sendMail(options: SendMailOptions): Promise<SendMailResult> {
    const res = await emailService.sendEmail({
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
    });
    return {
      success: res.success,
      messageId: res.messageId,
      skipped: res.skipped,
      error: res.error,
    };
  }

  async sendOrderCreatedAdminNotification(data: AdminOrderCreatedEmailData): Promise<boolean> {
    const res = await emailService.sendOrderCreatedAdminNotification(data);
    return res.success;
  }

  async sendOrderPaidAdminNotification(data: AdminOrderPaidEmailData): Promise<boolean> {
    const res = await emailService.sendOrderPaidAdminNotification(data);
    return res.success;
  }

  async sendStockAlert(alert: StockAlertData): Promise<boolean> {
    const res = await emailService.sendStockAlertEmail(alert);
    return res.success;
  }

  async sendBatchStockAlerts(alerts: StockAlertData[]): Promise<boolean> {
    for (const alert of alerts) {
      await emailService.sendStockAlertEmail(alert);
    }
    return true;
  }

  async sendCustomAdminNotification(data: AdminCustomNotificationData): Promise<boolean> {
    const res = await emailService.sendEmail({
      subject: `[ParkPing] ${data.subject}`,
      text: `${data.title}\n\n${data.message}`,
      html: `<h2>${data.title}</h2><p>${data.message}</p>`,
    });
    return res.success;
  }

  async checkAndAlertLowStock(options?: {
    skus?: string[] | undefined;
    triggeredBy?: string | undefined;
    bypassCooldown?: boolean | undefined;
  }): Promise<StockAlertData[]> {
    return await emailService.checkAndAlertLowStock(options);
  }
}

export const mailService = new MailService();
export { emailService };
