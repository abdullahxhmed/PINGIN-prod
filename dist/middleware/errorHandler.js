const errorHandler = (err, req, res, next) => {
    if (err.name === "ValidationError") {
        const errors = {};
        for (const field in err.errors) {
            errors[field] = err.errors[field].message;
        }
        return res.status(400).json({
            message: "Validation failed",
            errors
        });
    }
    if (err.statusCode === 404) {
        return res.status(404).json({
            message: "Route not found"
        });
    }
    res.status(500).json({
        message: "Internal server error"
    });
};
export default errorHandler;
//# sourceMappingURL=errorHandler.js.map