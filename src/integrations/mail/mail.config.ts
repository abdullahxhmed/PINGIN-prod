import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import type { MailConfig } from "./mail.types.js";
import { logger } from "../../lib/logger.js";

export const getMailConfig = (): MailConfig => {
  const host = process.env.SMTP_HOST || "";
  const port = parseInt(process.env.SMTP_PORT || "587", 10);
  const secure =
    process.env.SMTP_SECURE === "true" ||
    (process.env.SMTP_SECURE !== "false" && port === 465);
  const service = process.env.SMTP_SERVICE || undefined;
  const user = process.env.SMTP_USER || process.env.EMAIL_USER || "";
  const pass = process.env.SMTP_PASS || process.env.EMAIL_PASS || "";
  const from =
    process.env.EMAIL_FROM ||
    process.env.SMTP_FROM ||
    '"ParkPing" <no-reply@parkping.com>';
  const adminEmail = process.env.ADMIN_EMAIL || "admin@parkping.com";

  return {
    host,
    port,
    secure,
    service,
    user,
    pass,
    from,
    adminEmail,
  };
};

export const isMailConfigured = (): boolean => {
  const config = getMailConfig();
  // Configured if credentials and a destination are present
  return Boolean((config.host || config.service) && config.user && config.pass);
};

let transporterInstance: Transporter | null = null;
let lastUser = "";
let lastPass = "";
let lastHost = "";
let lastPort = 0;

export const getMailTransporter = (): Transporter | null => {
  const config = getMailConfig();

  if (!isMailConfigured()) {
    return null;
  }

  // Reuse instance if credentials have not changed
  if (
    transporterInstance &&
    lastUser === config.user &&
    lastPass === config.pass &&
    lastHost === config.host &&
    lastPort === config.port
  ) {
    return transporterInstance;
  }

  try {
    if (config.service) {
      transporterInstance = nodemailer.createTransport({
        service: config.service,
        auth: {
          user: config.user,
          pass: config.pass,
        },
      });
    } else {
      transporterInstance = nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: {
          user: config.user,
          pass: config.pass,
        },
      });
    }

    lastUser = config.user || "";
    lastPass = config.pass || "";
    lastHost = config.host || "";
    lastPort = config.port || 0;

    return transporterInstance;
  } catch (err: any) {
    logger.error({ err }, "Failed to initialize nodemailer transporter");
    return null;
  }
};

