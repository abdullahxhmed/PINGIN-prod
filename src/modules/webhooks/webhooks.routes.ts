import Router from "express";
import { edesyWebhookController } from "./edesy.controller.js";
import { razorpayWebhookController } from "./razorpay.webhook.js";

const WebhookRouter = Router();

WebhookRouter
    .route("/edesy")
    .post(edesyWebhookController);

WebhookRouter
    .route("/razorpay")
    .post(razorpayWebhookController);

export default WebhookRouter;