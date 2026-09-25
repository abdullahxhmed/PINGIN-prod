import asyncHandler from "express-async-handler";
import { BadRequestError } from "../../errors/AppError.js";
import { getCommunicationCallStatus, initiateCall } from "./communication.service.js";


const initiateCallController = asyncHandler (async(
  req,
  res,
  next
) => {
    const ip = req.ip!;
  try {
    const { token } = req.params;

      if (!token || Array.isArray(token)) {
          throw new BadRequestError("Invalid contact token");
      }

      const result = await initiateCall({
          token,
          visitorPhoneNumber: req.body.phoneNumber,
          ip
      });

    res.status(201).json({
      data: result,
    });
  } catch (error) {
    next(error);
  }
});
const getCommunicationCallStatusController = asyncHandler(
    async (req, res) => {
        const { callId } = req.params;

        if (!callId || Array.isArray(callId)) {
            throw new BadRequestError("Invalid call ID");
        }

        const call =
            await getCommunicationCallStatus(callId);

        res.status(200).json({
            data: call,
        });
    }
);

export {
    initiateCallController,
    getCommunicationCallStatusController
}