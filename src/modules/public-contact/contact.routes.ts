import express from "express"
import { getContactController, verifyRegNumController } from "./contact.controllers.js"



const router = express.Router()

router.route('/:token')
    .get(getContactController)

router.route('/:token/verify')
    .post(verifyRegNumController)

export default router;