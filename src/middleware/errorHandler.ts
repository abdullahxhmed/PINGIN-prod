import type {Request, Response, NextFunction} from "express";

const errorHandler = (err:any , req: Request, res: Response, next: NextFunction) => {
    if (err.name === "ValidationError") {

        const errors: Record<string, string> = {};

        for (const field in err.errors) {
            errors[field] = err.errors[field].message;
        }

        return res.status(400).json({
            message: "Validation failed",
            errors
        });
    }
    if(err.statusCode === 404){
        return res.status(404).json({
            message: "Route not found"
        })
    }

    res.status(500).json({
        message: "Internal server error"
    });
};


export default errorHandler;