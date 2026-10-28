import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { logger } from "../lib/logger.js";

export interface MailerConfig {
  host: string;
  port: number;
  secure: boolean;
  service?: string | undefined;
  user: string;
  pass: string;
  from: string;
  adminEmail: string;
}

export const getMailerConfig = (): MailerConfig => {
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
    ...(service ? { service } : {}),
    user,
    pass,
    from,
    adminEmail,
  };
};

export const isMailerConfigured = (): boolean => {
  const config = getMailerConfig();
  return Boolean((config.host || config.service) && config.user && config.pass);
};

let transporterInstance: Transporter | null = null;
let lastUser = "";
let lastPass = "";
let lastHost = "";
let lastPort = 0;

export const getMailerTransporter = (): Transporter | null => {
  const config = getMailerConfig();

  if (!isMailerConfigured()) {
    return null;
  }

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

    lastUser = config.user;
    lastPass = config.pass;
    lastHost = config.host;
    lastPort = config.port;

    return transporterInstance;
  } catch (err: any) {
    logger.error({ err }, "Failed to initialize nodemailer transporter");
    return null;
  }
};

export const verifyMailerConnection = async (): Promise<{
  ready: boolean;
  error?: string | undefined;
}> => {
  if (!isMailerConfigured()) {
    return {
      ready: false,
      error:
        "SMTP credentials not configured (waiting for SMTP_HOST/SMTP_USER/SMTP_PASS in .env).",
    };
  }

  const transporter = getMailerTransporter();
  if (!transporter) {
    return { ready: false, error: "Failed to initialize mailer transporter." };
  }

  try {
    await transporter.verify();
    logger.info("Nodemailer SMTP transporter verified and ready.");
    return { ready: true };
  } catch (err: any) {
    logger.warn({ err: err.message }, "Nodemailer SMTP verification failed.");
    return { ready: false, error: err.message };
  }
};
