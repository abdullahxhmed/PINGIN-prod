import crypto from "node:crypto";
import redis from "../lib/redis.js";
import { TooManyRequestsError } from "../errors/AppError.js";

const OTP_COOLDOWN_SECONDS = 60;
const OTP_WINDOW_SECONDS = 60 * 60;

const PHONE_LIMIT = 3;
const IP_LIMIT = 10;

const hashValue = (value: string) =>
    crypto
        .createHash("sha256")
        .update(value)
        .digest("hex");

const otpRateLimitScript = `
local phoneCooldown = KEYS[1]
local phoneHourly = KEYS[2]
local ipHourly = KEYS[3]

local phoneLimit = tonumber(ARGV[1])
local ipLimit = tonumber(ARGV[2])
local cooldownSeconds = tonumber(ARGV[3])
local windowSeconds = tonumber(ARGV[4])

if redis.call("EXISTS", phoneCooldown) == 1 then
    return 1
end

local phoneCount = tonumber(redis.call("GET", phoneHourly) or "0")

if phoneCount >= phoneLimit then
    return 2
end

local ipCount = tonumber(redis.call("GET", ipHourly) or "0")

if ipCount >= ipLimit then
    return 3
end

redis.call("SET", phoneCooldown, "1", "EX", cooldownSeconds)

local newPhoneCount = redis.call("INCR", phoneHourly)

if newPhoneCount == 1 then
    redis.call("EXPIRE", phoneHourly, windowSeconds)
end

local newIpCount = redis.call("INCR", ipHourly)

if newIpCount == 1 then
    redis.call("EXPIRE", ipHourly, windowSeconds)
end

return 0
`;

export const checkOtpRateLimit = async (
    mobileNumber: string,
    ip: string
) => {
    const phoneHash = hashValue(mobileNumber);
    const ipHash = hashValue(ip);

    const phoneCooldownKey = `otp:cooldown:${phoneHash}`;
    const phoneHourlyKey = `otp:phone:${phoneHash}`;
    const ipHourlyKey = `otp:ip:${ipHash}`;

    const result = await redis.eval(
        otpRateLimitScript,
        3,
        phoneCooldownKey,
        phoneHourlyKey,
        ipHourlyKey,
        PHONE_LIMIT,
        IP_LIMIT,
        OTP_COOLDOWN_SECONDS,
        OTP_WINDOW_SECONDS
    );

    switch (result) {
        case 1:
            throw new TooManyRequestsError(
                "Please wait 60 seconds before requesting another OTP"
            );

        case 2:
            throw new TooManyRequestsError(
                "OTP request limit reached for this phone number"
            );

        case 3:
            throw new TooManyRequestsError(
                "Too many OTP requests. Please try again later"
            );
    }
};