import crypto from "crypto";

// Common crawlers, search engines, WhatsApp/Telegram/Slack/iMessage/social preview bots
const BOT_UA_REGEX =
  /bot|spider|crawl|slurp|facebookexternalhit|whatsapp|telegrambot|slackbot|twitterbot|applebot|linkedinbot|discordbot|bingpreview|google-read-aloud/i;

export interface ParsedDeviceInfo {
  isBot: boolean;
  deviceType: "MOBILE" | "DESKTOP" | "TABLET" | "UNKNOWN";
  os: "IOS" | "ANDROID" | "WINDOWS" | "MACOS" | "LINUX" | "OTHER";
  browser: "CHROME" | "SAFARI" | "FIREFOX" | "EDGE" | "OTHER";
}

/** Check if User-Agent is an automated crawler or link preview scraper */
export const isBotUserAgent = (ua: string | undefined): boolean => {
  if (!ua) return true;
  return BOT_UA_REGEX.test(ua);
};

/** Parse User-Agent into coarse, anonymous buckets (never stores raw string) */
export const parseUserAgent = (ua: string | undefined): ParsedDeviceInfo => {
  if (!ua) {
    return { isBot: true, deviceType: "UNKNOWN", os: "OTHER", browser: "OTHER" };
  }

  const isBot = BOT_UA_REGEX.test(ua);
  const uaLower = ua.toLowerCase();

  let deviceType: ParsedDeviceInfo["deviceType"] = "UNKNOWN";
  if (isBot) {
    deviceType = "UNKNOWN";
  } else if (/ipad|tablet|(android(?!.*mobile))/i.test(uaLower)) {
    deviceType = "TABLET";
  } else if (/mobi|iphone|android/i.test(uaLower)) {
    deviceType = "MOBILE";
  } else {
    deviceType = "DESKTOP";
  }

  let os: ParsedDeviceInfo["os"] = "OTHER";
  if (/iphone|ipad|ipod/i.test(uaLower)) os = "IOS";
  else if (/android/i.test(uaLower)) os = "ANDROID";
  else if (/windows/i.test(uaLower)) os = "WINDOWS";
  else if (/macintosh|mac os x/i.test(uaLower)) os = "MACOS";
  else if (/linux/i.test(uaLower)) os = "LINUX";

  let browser: ParsedDeviceInfo["browser"] = "OTHER";
  if (/edg/i.test(uaLower)) browser = "EDGE";
  else if (/chrome|crios/i.test(uaLower)) browser = "CHROME";
  else if (/safari/i.test(uaLower) && !/chrome/i.test(uaLower)) browser = "SAFARI";
  else if (/firefox|fxios/i.test(uaLower)) browser = "FIREFOX";

  return { isBot, deviceType, os, browser };
};

/** Hash IP with a daily rotating salt (cannot be reversed to track across days) */
export const hashIpAddress = (ip: string | undefined): string => {
  if (!ip) return "unknown";
  const dayKey = new Date().toISOString().slice(0, 10);
  const secret = process.env.JWT_SECRET || "privacy_salt";
  return crypto
    .createHmac("sha256", secret)
    .update(`${ip}:${dayKey}`)
    .digest("hex")
    .slice(0, 16);
};
