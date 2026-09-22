import express from "express"
import { getContactController } from "./contact.controllers.js"



const router = express.Router()

router.route('/:token')
    .get(getContactController)

export default router;