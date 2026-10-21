import "http";
import { UserRole } from "@prisma/client";

declare module "http" {
  interface IncomingMessage {
    rawBody?: Buffer;
  }
}

declare global {
  namespace Express {
    interface Request {
      user: {
        id: string;
        /** Present after requireAdmin; undefined after authenticateRequest alone */
        role?: UserRole;
      };
    }
  }
}

export {};