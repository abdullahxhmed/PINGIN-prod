import crypto from "node:crypto";
import {prisma} from "../../lib/prisma.js"
import type { EdesyWebhookPayload } from "./edesy-schema.js";


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

    try {
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

        const call =
            await prisma.communicationCall.findUnique({
                where: {
                    callSid: payload.call_sid,
                },
            });

        if (!call) {
            throw new Error(
                `CommunicationCall not found for callSid ${payload.call_sid}`
            );
        }

        switch (payload.event) {
            case "call.incoming":
                await prisma.communicationCall.update({
                    where: {
                        id: call.id,
                    },
                    data: {
                        status: "INCOMING",
                        incomingAt: new Date(),
                        providerStatus:
                            payload.status ?? null,
                    },
                });
                break;

            case "call.connected":
                await prisma.communicationCall.update({
                    where: {
                        id: call.id,
                    },
                    data: {
                        status: "CONNECTED",
                        connectedAt: new Date(),
                        providerStatus:
                            payload.status ?? null,
                    },
                });
                break;

            case "call.ended":
                await prisma.communicationCall.update({
                    where: {
                        id: call.id,
                    },
                    data: {
                        status: "COMPLETED",
                        endedAt: new Date(),
                        durationSec:
                            payload.duration_sec ?? null,
                        providerStatus:
                            payload.status ?? null,
                    },
                });
                break;

            case "call.missed":
                await prisma.communicationCall.update({
                    where: {
                        id: call.id,
                    },
                    data: {
                        status: "MISSED",
                        endedAt: new Date(),
                        providerStatus:
                            payload.status ?? null,
                    },
                });
                break;
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
}