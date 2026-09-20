import express from "express";
import dotenv from "dotenv";
import errorHandler from "./middleware/errorHandler.js";

dotenv.config();
const PORT = process.env.PORT || 3000;

const app = express();

app.use(express.json());

app.get('/api/health', (req,res) => {
    console.log("Health is OK");
    res.status(200).json({
        message:"Health is OK"
    })
})

app.use((req, res, next) => {
    const error = new Error("Route not found");
    (error as any).statusCode = 404
    next(error);
})


app.use(errorHandler);

app.listen(PORT, () => {
    console.log(`Server started on Port: ${PORT}`);
})