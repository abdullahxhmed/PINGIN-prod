import { AppError } from "../errors/AppError.js";
const errorHandler = (err, req, res, next) => {
    if (err instanceof AppError) {
        return res.status(err.statusCode).json({
            error: err.message
        });
    }
    console.error(err);
    return res.status(500).json({
        message: "Internal server error"
    });
};
export default errorHandler;
//# sourceMappingURL=errorHandler.js.map