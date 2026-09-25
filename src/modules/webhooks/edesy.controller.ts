import { UnauthorizedError,InternalError,BadRequestError } from "../../errors/AppError.js";
import { edesyWebhookSchema } from "./edesy-schema.js";
import asyncHandler from "express-async-handler"
import { handleEdesyWebhook, verifyEdesySignature } from "./edesy.webhook.js";

export const edesyWebhookController = asyncHandler(
    async (req, res) => {
        const signature =
            req.header("X-Edesy-Signature");

        if (!signature) {
            throw new UnauthorizedError(
                "Missing Edesy signature"
            );
        }

        if (!req.rawBody) {
            throw new InternalError(
                "Raw request body unavailable"
            );
        }

        const secret =
            process.env.EDESY_WEBHOOK_SECRET;

        if (!secret) {
            throw new InternalError(
                "Edesy webhook secret not configured"
            );
        }

        const valid =
            verifyEdesySignature(
                req.rawBody,
                signature,
                secret
            );

        if (!valid) {
            throw new UnauthorizedError(
                "Invalid Edesy signature"
            );
        }

        const result =
            edesyWebhookSchema.safeParse(
                req.body
            );

        if (!result.success) {
            throw new BadRequestError(
                "Invalid Edesy webhook payload"
            );
        }

        await handleEdesyWebhook(
            result.data
        );

        res.status(200).json({
            message: "Webhook received",
        });
    }
);