import Router from "express";
import { getCommunicationCallStatusController, initiateCallController} from "./communication.controller.js"
import { checkCallRateLimit } from "../../middleware/call-rateLimiter.js";


const CommunicationRouter = Router();

CommunicationRouter.post(
    "/:token/call",
    initiateCallController
);


CommunicationRouter.route('/calls/:callId')
    .get(getCommunicationCallStatusController);

export default CommunicationRouter;
