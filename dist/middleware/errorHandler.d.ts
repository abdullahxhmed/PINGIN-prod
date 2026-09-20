import type { Request, Response, NextFunction } from "express";
declare const errorHandler: (err: any, req: Request, res: Response, next: NextFunction) => Response<any, Record<string, any>> | undefined;
export default errorHandler;
//# sourceMappingURL=errorHandler.d.ts.map