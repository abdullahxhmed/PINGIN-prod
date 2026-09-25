import crypto from "node:crypto";
import redis from "../lib/redis.js";
import { TooManyRequestsError } from "../errors/AppError.js";


const COOLDOWN_SECONDS = 2 * 60;
const WINDOW_SECONDS = 60 * 60;

const LINK_LIMIT = 5;
const IP_LIMIT = 10;

const hashValue = (value: string) =>
    crypto
        .createHash("sha256")
        .update(value)
        .digest("hex");

const callRateLimitScript = `
local linkCooldown = KEYS[1]
local linkHourly = KEYS[2]
local ipHourly = KEYS[3]

local linkLimit = tonumber(ARGV[1])
local ipLimit = tonumber(ARGV[2])
local cooldownSeconds = tonumber(ARGV[3])
local windowSeconds = tonumber(ARGV[4])

if redis.call("EXISTS", linkCooldown) == 1 then
    return 1
end

local linkCount = tonumber(redis.call("GET", linkHourly) or "0")

if linkCount >= linkLimit then
    return 2
end

local ipCount = tonumber(redis.call("GET", ipHourly) or "0")

if ipCount >= ipLimit then
    return 3
end

redis.call("SET", linkCooldown, "1", "EX", cooldownSeconds)

local newLinkCount = redis.call("INCR", linkHourly)

if newLinkCount == 1 then
    redis.call("EXPIRE", linkHourly, windowSeconds)
end

local newIpCount = redis.call("INCR", ipHourly)

if newIpCount == 1 then
    redis.call("EXPIRE", ipHourly, windowSeconds)
end

return 0
`;

export const checkCallRateLimit = async (
    contactLinkId: string,
    ip: string
) => {
    const ipHash = hashValue(ip);

    const linkCooldownKey =
        `call:cooldown:${contactLinkId}`;

    const linkHourlyKey =
        `call:link:${contactLinkId}`;

    const ipHourlyKey =
        `call:ip:${ipHash}`;

    const result = await redis.eval(
        callRateLimitScript,
        3,
        linkCooldownKey,
        linkHourlyKey,
        ipHourlyKey,
        LINK_LIMIT,
        IP_LIMIT,
        COOLDOWN_SECONDS,
        WINDOW_SECONDS
    );

    switch (result) {
        case 1:
            throw new TooManyRequestsError(
                "Please wait before making another call"
            );

        case 2:
            throw new TooManyRequestsError(
                "This contact link has reached its call limit"
            );

        case 3:
            throw new TooManyRequestsError(
                "Too many call requests. Please try again later"
            );
    }
};