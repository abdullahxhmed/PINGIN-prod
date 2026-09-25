import Router from "express";
import { edesyWebhookController } from "./edesy.controller.js";

const WebhookRouter = Router();

WebhookRouter
    .route("/edesy")
    .post(edesyWebhookController)

export default WebhookRouter;