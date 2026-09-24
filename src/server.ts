import dotenv from "dotenv";
import express from "express";
import errorHandler from "./middleware/errorHandler.js";
import { authenticateRequest } from "./modules/auth/auth.middleware.js";
import authRoutes from "./modules/auth/auth.routes.js";
import contactRoutes from "./modules/public-contact/contact.routes.js";
import resourceRoutes from "./modules/resources/resources.routes.js";
import userRoutes from "./modules/users/users.routes.js";
import cookieParser from "cookie-parser";
import vehicleRoutes from "./modules/vehicle-details/vehicleDetail.routes.js"
dotenv.config();
const PORT = process.env.PORT || 8080;

const app = express();
import cors from "cors";

app.use(
  cors({
    origin: [
      "https://pingin.co.in",
      "https://www.pingin.co.in",
    ],
    credentials: true,
  })
);

app.use(
  express.json({
    limit: "100kb",
    verify: (req, _res, buf) => {
      req.rawBody = Buffer.from(buf);
    },
  })
);
app.use(cookieParser());

app.use('/api/users', userRoutes);
app.use('/api/resources', authenticateRequest, resourceRoutes);
app.use('/api/vehicle-details', vehicleRoutes);
app.use('/api/contact', contactRoutes)
app.use('/api/auth', authRoutes);

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
