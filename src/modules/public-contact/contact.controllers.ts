import asyncHandler from "express-async-handler";
import { z } from "zod";
import { BadRequestError } from "../../errors/AppError.js";
import { initiateCall } from "../communication/communication.service.js";
import { getContact, verifyRegistrationNum } from "./contact.services.js";
import { edesyService } from "../../integrations/edesy.service.js";

/**
 * @description Get public resource details
 * @route GET /api/contact/:token
 * @access public
 */

const getContactController = asyncHandler (async (req,res,next) => {
     const {token} = req.params;
    
        if(typeof token !== "string"){
            throw new BadRequestError("Resource ID is required");
        }
    const resource = await getContact(
        token
    )
    res.status(200).json(resource);
})

const verifyRegNumController = asyncHandler (async (req, res, next) =>{
    const {registrationNum} = req.body; 
    const {token} = req.params;
    if (typeof token !== "string" || typeof registrationNum !== "string") {
        throw new BadRequestError("Invalid contact token or registrationNum");
    }
    await verifyRegistrationNum(token, registrationNum);
    res.status(200).json({
        success: true,
        message: "verified"
    });

})
const callSchema = z.object({
  phoneNumber: z.string().min(10).max(13),
});

/**
 * @description Initiate a private communication session/cal
 * @route GET /api/contact/:token/call
 * @access public
 */


import { prisma } from "../../lib/prisma.js";
import redis from "../../lib/redis.js";
import {
  isBotUserAgent,
  parseUserAgent,
  hashIpAddress,
} from "../../utils/privacy-analytics.js";
import crypto from "crypto";

/**
 * @description Record a tag visit beacon from the client
 * @route POST /api/contact/:token/visit
 * @access public
 */
const recordTagVisitController = asyncHandler(async (req, res) => {
  const { token } = req.params;
  const { visitId, source } = req.body;

  if (typeof token !== "string") {
    throw new BadRequestError("Token is required");
  }

  // 1. Filter out automated bots, spiders, and link preview scrapers
  const ua = req.headers["user-agent"];
  if (isBotUserAgent(ua)) {
    res.status(200).json({ status: "ignored" });
    return;
  }

  // 2. Validate allowlisted source
  const normalizedSource = typeof source === "string" ? source.toLowerCase() : "direct";
  const validatedSource = (
    normalizedSource === "qr_scan"
      ? "QR_SCAN"
      : normalizedSource === "share"
      ? "SHARE"
      : "DIRECT"
  ) as "QR_SCAN" | "SHARE" | "DIRECT";

  // 3. Resolve token first — do NOT write to DB for non-existent / invalid tokens
  const contactLink = await prisma.contactLink.findUnique({
    where: { token, active: true },
    select: {
      resourceId: true,
      resource: {
        select: {
          id: true,
          qrTag: {
            where: { status: "ASSIGNED" },
            select: { id: true },
            take: 1,
          },
        },
      },
    },
  });

  if (!contactLink) {
    res.status(404).json({ error: "Invalid contact link" });
    return;
  }

  // 4. Deduplicate using Redis: 1 visit per visitor (hashed IP) and resource per 30 seconds
  const ipHash = hashIpAddress(req.ip);
  const dedupeKey = `dedupe:visit:${contactLink.resourceId}:${ipHash}`;

  let isNewVisit = true;
  try {
    const redisResult = await redis.set(dedupeKey, "1", "EX", 30, "NX");
    isNewVisit = Boolean(redisResult);
  } catch (redisErr) {
    // If Redis is unavailable, don't fail the request
    console.error("Redis dedupe error in recordTagVisitController:", redisErr);
  }

  if (!isNewVisit) {
    res.status(200).json({ status: "deduplicated" });
    return;
  }

  // 5. Fire-and-forget DB write (Never fails or delays client response)
  const { deviceType, os, browser } = parseUserAgent(ua);
  const safeVisitId =
    typeof visitId === "string" && visitId.length >= 8 && visitId.length <= 64
      ? visitId
      : crypto.randomUUID();

  setImmediate(async () => {
    try {
      await prisma.tagVisit.create({
        data: {
          visitId: safeVisitId,
          resourceId: contactLink.resourceId,
          qrTagId: contactLink.resource.qrTag[0]?.id ?? null,
          source: validatedSource,
          deviceType,
          os,
          browser,
          ipHash,
        },
      });
    } catch (err) {
      console.error("Failed to record TagVisit in background:", err);
    }
  });

  res.status(200).json({ status: "recorded", visitId: safeVisitId });
});

export {
  getContactController,
  verifyRegNumController,
  recordTagVisitController,
};

