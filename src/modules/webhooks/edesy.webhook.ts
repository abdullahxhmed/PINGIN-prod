import crypto from "node:crypto";
import { prisma } from "../../lib/prisma.js";
import { logger } from "../../lib/logger.js";
import { encryptPhoneNumber } from "../../utils/phone-encryption.js";
import type { communicationCallStatus } from "@prisma/client";
import type { EdesyWebhookPayload } from "./edesy-schema.js";

const STATUS_PRECEDENCE: Record<communicationCallStatus, number> = {
    INITIATED: 1,
    INCOMING: 2,
    CONNECTED: 3,
    COMPLETED: 4,
    MISSED: 4,
};

function parseEventTimestamp(raw?: string): Date {
    if (!raw) return new Date();
    const parsed = new Date(raw);
    return isNaN(parsed.getTime()) ? new Date() : parsed;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function findCallWithRetries(callSid: string, delays = [150, 300, 600, 1000]) {
    let call = await prisma.communicationCall.findUnique({
        where: { callSid },
    });
    if (call) return call;

    for (const delay of delays) {
        await sleep(delay);
        call = await prisma.communicationCall.findUnique({
            where: { callSid },
        });
        if (call) return call;
    }
    return null;
}

const verifyEdesySignature = (
    rawBody: Buffer,
    signature: string,
    secret: string
) => {
    const expectedSignature =
        "sha256=" +
        crypto
            .createHmac("sha256", secret)
            .update(rawBody)
            .digest("hex");

    const expected = Buffer.from(
        expectedSignature,
        "utf8"
    );

    const received = Buffer.from(
        signature,
        "utf8"
    );

    if (expected.length !== received.length) {
        return false;
    }

    return crypto.timingSafeEqual(
        expected,
        received
    );
};

const handleEdesyWebhook = async (
    payload: EdesyWebhookPayload
) => {
    const webhookEvent =
        await prisma.edesyWebhookEvent.create({
            data: {
                event: payload.event,
                reference: payload.reference ?? null,
                callSid: payload.call_sid ?? null,
                payload,
            },
        });

    const eventTime = parseEventTimestamp(payload.timestamp);

    try {
        // Handle session lifecycle events even if call_sid is not present
        if (payload.event === "session.created" && payload.reference) {
            await prisma.communicationSession.updateMany({
                where: {
                    reference: payload.reference,
                    status: "PENDING",
                },
                data: {
                    status: "ACTIVE",
                },
            });
        }

        if (payload.event === "session.expired" && payload.reference) {
            await prisma.communicationSession.updateMany({
                where: {
                    reference: payload.reference,
                    status: { not: "EXPIRED" },
                },
                data: {
                    status: "EXPIRED",
                    endedAt: eventTime,
                },
            });
        }

        if (!payload.call_sid) {
            await prisma.edesyWebhookEvent.update({
                where: {
                    id: webhookEvent.id,
                },
                data: {
                    processedAt: new Date(),
                },
            });

            return;
        }

        // 1. Primary lookup: find call with backoff retries to handle race condition with call initiation DB write
        let call = await findCallWithRetries(payload.call_sid);

        // 2. Fallback lookup by reference if callSid not yet linked
        if (!call && payload.reference) {
            const session = await prisma.communicationSession.findUnique({
                where: { reference: payload.reference },
                include: { calls: true },
            });

            if (session) {
                if (session.calls.length > 0) {
                    const existingCall = session.calls.find((c) => c.callSid === payload.call_sid) || session.calls[0];
                    if (existingCall) {
                        if (existingCall.callSid !== payload.call_sid) {
                            call = await prisma.communicationCall.update({
                                where: { id: existingCall.id },
                                data: { callSid: payload.call_sid },
                            });
                        } else {
                            call = existingCall;
                        }
                    }
                } else {
                    call = await prisma.communicationCall.create({
                        data: {
                            sessionId: session.id,
                            callSid: payload.call_sid,
                            caller: payload.caller ? encryptPhoneNumber(payload.caller) : session.contactorPhoneNumber,
                            callee: payload.callee ? encryptPhoneNumber(payload.callee) : "",
                            direction: payload.direction || "click_to_call",
                            status: "INITIATED",
                            providerStatus: payload.status ?? null,
                        },
                    });
                }
            }
        }

        // 3. Fallback lookup: recent active session (last 10m) if caller is known
        if (!call && payload.caller) {
            try {
                const recentSession = await prisma.communicationSession.findFirst({
                    where: {
                        status: { in: ["PENDING", "ACTIVE"] },
                        createdAt: { gte: new Date(Date.now() - 10 * 60 * 1000) },
                    },
                    orderBy: { createdAt: "desc" },
                    include: { calls: true },
                });

                if (recentSession && recentSession.calls.length === 0) {
                    call = await prisma.communicationCall.create({
                        data: {
                            sessionId: recentSession.id,
                            callSid: payload.call_sid,
                            caller: encryptPhoneNumber(payload.caller),
                            callee: payload.callee ? encryptPhoneNumber(payload.callee) : "",
                            direction: payload.direction || "click_to_call",
                            status: "INITIATED",
                            providerStatus: payload.status ?? null,
                        },
                    });
                }
            } catch (fallbackErr) {
                logger.warn({ err: fallbackErr }, "Error executing recent session fallback in webhook");
            }
        }

        // 4. If call still cannot be resolved after all retries and fallbacks
        if (!call) {
            logger.warn(
                { callSid: payload.call_sid, event: payload.event, reference: payload.reference },
                "CommunicationCall not found for callSid after retries and fallbacks; acknowledging to prevent infinite webhook retries"
            );
            await prisma.edesyWebhookEvent.update({
                where: { id: webhookEvent.id },
                data: {
                    error: `CommunicationCall not found for callSid ${payload.call_sid}`,
                    processedAt: new Date(),
                },
            });
            return;
        }

        const currentPrecedence = STATUS_PRECEDENCE[call.status] ?? 0;

        switch (payload.event) {
            case "call.incoming": {
                // If call is already at INCOMING or higher (CONNECTED, COMPLETED, MISSED), don't regress status
                if (currentPrecedence >= STATUS_PRECEDENCE.INCOMING) {
                    if (payload.status && payload.status !== call.providerStatus) {
                        await prisma.communicationCall.update({
                            where: { id: call.id },
                            data: { providerStatus: payload.status },
                        });
                    }
                    break;
                }

                await prisma.communicationCall.update({
                    where: { id: call.id },
                    data: {
                        status: "INCOMING",
                        incomingAt: call.incomingAt ?? eventTime,
                        providerStatus: payload.status ?? call.providerStatus,
                    },
                });
                break;
            }

            case "call.connected": {
                // If call is already at CONNECTED or higher (COMPLETED, MISSED), don't regress status
                if (currentPrecedence >= STATUS_PRECEDENCE.CONNECTED) {
                    if (payload.status && payload.status !== call.providerStatus) {
                        await prisma.communicationCall.update({
                            where: { id: call.id },
                            data: { providerStatus: payload.status },
                        });
                    }
                    break;
                }

                await prisma.communicationCall.update({
                    where: { id: call.id },
                    data: {
                        status: "CONNECTED",
                        connectedAt: call.connectedAt ?? eventTime,
                        incomingAt: call.incomingAt ?? eventTime,
                        providerStatus: payload.status ?? call.providerStatus,
                    },
                });
                break;
            }

            case "call.ended": {
                const isAlreadyEnded = call.status === "COMPLETED";
                const updateData: any = {
                    providerStatus: payload.status ?? call.providerStatus,
                };

                if (!isAlreadyEnded) {
                    updateData.status = "COMPLETED";
                    updateData.endedAt = call.endedAt ?? eventTime;
                    if (payload.duration_sec != null) {
                        updateData.durationSec = payload.duration_sec;
                    }
                } else if (payload.duration_sec != null && call.durationSec == null) {
                    updateData.durationSec = payload.duration_sec;
                }

                await prisma.$transaction([
                    prisma.communicationCall.update({
                        where: { id: call.id },
                        data: updateData,
                    }),
                    prisma.communicationSession.updateMany({
                        where: { id: call.sessionId, status: { not: "EXPIRED" } },
                        data: {
                            status: "EXPIRED",
                            endedAt: eventTime,
                        },
                    }),
                ]);
                break;
            }

            case "call.missed": {
                const isTerminal = call.status === "MISSED" || call.status === "COMPLETED";
                const updateData: any = {
                    providerStatus: payload.status ?? call.providerStatus,
                };

                if (!isTerminal) {
                    updateData.status = "MISSED";
                    updateData.endedAt = call.endedAt ?? eventTime;
                }

                await prisma.$transaction([
                    prisma.communicationCall.update({
                        where: { id: call.id },
                        data: updateData,
                    }),
                    prisma.communicationSession.updateMany({
                        where: { id: call.sessionId, status: { not: "EXPIRED" } },
                        data: {
                            status: "EXPIRED",
                            endedAt: eventTime,
                        },
                    }),
                ]);
                break;
            }

            case "session.expired": {
                await prisma.communicationSession.updateMany({
                    where: { id: call.sessionId, status: { not: "EXPIRED" } },
                    data: {
                        status: "EXPIRED",
                        endedAt: eventTime,
                    },
                });
                break;
            }
        }

        await prisma.edesyWebhookEvent.update({
            where: {
                id: webhookEvent.id,
            },
            data: {
                processedAt: new Date(),
            },
        });

    } catch (error) {
        await prisma.edesyWebhookEvent.update({
            where: {
                id: webhookEvent.id,
            },
            data: {
                error:
                    error instanceof Error
                        ? error.message
                        : "Unknown error",
            },
        });

        throw error;
    }
};

export {
    handleEdesyWebhook,
    verifyEdesySignature
};