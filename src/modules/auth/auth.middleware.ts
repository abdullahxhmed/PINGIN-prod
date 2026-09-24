import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { BadRequestError, UnauthorizedError } from "../../errors/AppError.js";

const authenticateRequest = async (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization
    // console.log("Verification secret exists:", !!process.env.JWT_SECRET);
    if(!authHeader || !authHeader.startsWith("Bearer "))
        throw new BadRequestError("No Authorization header in request");

    const tokenBearer = authHeader.slice(7);

    let payload:any 
    
    try{
        payload = jwt.verify(tokenBearer, process.env.JWT_SECRET!);
    }
    catch(err:any){
        if(err.name === "TokenExpiredError"){
            throw new UnauthorizedError("jwt expired");
        }
        throw new UnauthorizedError("Invalid token");
    }

    if(
            typeof payload !== "object" ||
            !payload ||
            typeof payload.sub !== "string"
        ){
            throw new UnauthorizedError("Payload error");
        }
    req.user = {
        id: payload.sub
    }

    next();
}


export {
    authenticateRequest
};
