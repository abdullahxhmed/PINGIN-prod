import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { BadRequestError, UnauthorizedError } from "../../errors/AppError.js";
import { prisma } from "../../lib/prisma.js";
import redis from "../../lib/redis.js";


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

    // Throttled lastSeenAt update in background (at most once every 6 hours per user)
    const userId = payload.sub;
    setImmediate(async () => {
      try {
        const key = `user:lastSeen:${userId}`;
        const isFirstInWindow = await redis.set(key, "1", "EX", 21600, "NX");
        if (isFirstInWindow) {
          await prisma.user.update({
            where: { id: userId },
            data: { lastSeenAt: new Date() },
          });
        }
      } catch {
        // Non-blocking
      }
    });

    next();
}



export const optionalAuthenticateRequest = async (req: Request, _res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return next();
    }

    const tokenBearer = authHeader.slice(7);
    try {
        const payload: any = jwt.verify(tokenBearer, process.env.JWT_SECRET!);
        if (typeof payload === "object" && payload && typeof payload.sub === "string") {
            req.user = { id: payload.sub };
        }
    } catch {
        // Ignored for optional authentication
    }

    next();
};

export {
    authenticateRequest
};

