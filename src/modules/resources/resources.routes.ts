import express from "express";
import { createResourceController, getResourceByIdController, getResourceController, modifyResourceByIdController } from "./resources.controllers.js";
import { deleteResourceByIdController } from "./resources.controllers.js";


const router = express.Router();


router
    .route('/')
    .post(createResourceController)
    .get(getResourceController);

router
    .route('/:id')
    .get(getResourceByIdController)
    .patch(modifyResourceByIdController)
    .delete(deleteResourceByIdController);

// router
//     .route('/:id/contact-link')
//     .post(createContactLinkController);


export default router