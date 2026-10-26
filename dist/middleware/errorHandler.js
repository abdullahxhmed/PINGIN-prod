import { AppError } from "../errors/AppError.js";
import { logger } from "../lib/logger.js";
const errorHandler = (err, req, res, _next) => {
    const statusCode = typeof err?.statusCode === "number"
        ? err.statusCode
        : err instanceof AppError
            ? err.statusCode
            : 500;
    if (statusCode < 500) {
        if (req.log) {
            req.log.warn({ err, statusCode }, err.message);
        }
        else {
            logger.warn({ err, statusCode }, err.message);
        }
        return res.status(statusCode).json({
            error: err.message,
        });
    }
    if (req.log) {
        req.log.error({ err }, err?.message || "Internal server error");
    }
    else {
        logger.error({ err }, err?.message || "Internal server error");
    }
    return res.status(500).json({
        message: "Internal server error",
    });
};
export default errorHandler;
//# sourceMappingURL=errorHandler.js.map