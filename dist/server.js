import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import cookieParser from "cookie-parser";
import errorHandler from "./middleware/errorHandler.js";
import { apiRateLimiter } from "./middleware/rate-limiter.js";
import { logger, httpLogger } from "./lib/logger.js";
import { authenticateRequest } from "./modules/auth/auth.middleware.js";
import authRoutes from "./modules/auth/auth.routes.js";
import contactRoutes from "./modules/public-contact/contact.routes.js";
import resourceRoutes from "./modules/resources/resources.routes.js";
import userRoutes from "./modules/users/users.routes.js";
import webhookRoutes from "./modules/webhooks/webhooks.routes.js";
import communicationRoutes from "./modules/communication/communication.routes.js";
import vehicleRoutes from "./modules/vehicle-details/vehicleDetail.routes.js";
import qrRoutes from "./modules/qr/qr.routes.js";
import { redirectTagScanController } from "./modules/qr/qr.controllers.js";
import adminRoutes from "./modules/admin/admin.routes.js";
import subscriptionRoutes from "./modules/subscriptions/subscriptions.routes.js";
import catalogRoutes from "./modules/catalog/catalog.routes.js";
import inventoryRoutes from "./modules/inventory/inventory.routes.js";
import orderRoutes from "./modules/orders/orders.routes.js";
import { NotFoundError } from "./errors/AppError.js";
import { expireStaleReservations } from "./modules/inventory/inventory.services.js";
dotenv.config();
const PORT = process.env.PORT || 8080;
const app = express();
app.set("trust proxy", 1);
// HTTP request logging & correlation IDs
app.use(httpLogger);
app.use(cors({
    origin: [
        "https://kauntact.in",
        "https://www.kauntact.in",
        "http://localhost:5173",
    ],
    credentials: true,
}));
app.use(express.json({
    limit: "100kb",
    verify: (req, _res, buf) => {
        req.rawBody = Buffer.from(buf);
    },
}));
app.use(cookieParser());
app.use("/api/webhooks", webhookRoutes);
app.use("/api/communication", communicationRoutes);
app.use("/api/users", apiRateLimiter, userRoutes);
app.use("/api/resources", apiRateLimiter, authenticateRequest, resourceRoutes);
app.use("/api/vehicle-details", apiRateLimiter, vehicleRoutes);
app.use("/api/contact", apiRateLimiter, contactRoutes);
app.use("/api/auth", apiRateLimiter, authRoutes);
app.use("/api/qr", apiRateLimiter, qrRoutes);
app.use("/api/subscriptions", apiRateLimiter, subscriptionRoutes);
app.use("/api/catalog", apiRateLimiter, catalogRoutes);
app.use("/api/inventory", apiRateLimiter, inventoryRoutes);
app.use("/api/orders", apiRateLimiter, orderRoutes);
app.use("/api/admin", apiRateLimiter, adminRoutes);
// Permanent physical tag scanner redirects (/t/:token and legacy /qr/:token)
app.get("/t/:token", apiRateLimiter, redirectTagScanController);
app.get("/qr/:token", apiRateLimiter, redirectTagScanController);
app.get("/api/health", (_req, res) => {
    res.status(200).json({
        message: "Health is OK",
    });
});
app.use((_req, _res, next) => {
    next(new NotFoundError("Route not found"));
});
app.use(errorHandler);
app.listen(PORT, () => {
    logger.info(`Server started on Port: ${PORT}`);
    // Periodic background cleanup of expired cart reservations every 60 seconds
    setInterval(() => {
        expireStaleReservations().catch((err) => {
            logger.error({ err }, "Error expiring stale reservations");
        });
    }, 60_000);
});
//# sourceMappingURL=server.js.map