import Router from "express";
import { authenticateRequest } from "../auth/auth.middleware.js";
import { addVehicleDetailsController } from "./vehicleDetails.controller.js";

const vehicleRouter = Router();

vehicleRouter.use(authenticateRequest);

vehicleRouter
    .route('/')
    .post(addVehicleDetailsController);

export default vehicleRouter;



