import "http";

declare module "http" {
  interface IncomingMessage {
    rawBody?: Buffer;
  }
};
declare global {
  namespace Express {
    interface Request {
      user: {
        id: string;
      };
    }
  }
}

export {};