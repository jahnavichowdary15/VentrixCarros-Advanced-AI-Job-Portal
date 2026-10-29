
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { prisma } = require("./config/db");

// Route imports
const authRoutes = require("./routes/authRoutes");
const profileRoutes = require("./routes/profileRoutes");
const jobRoutes = require("./routes/jobRoutes");
const applicationRoutes = require("./routes/applicationRoutes");
const notificationRoutes = require("./routes/notificationRoutes");
const contactRoutes = require("./routes/contactRoutes");

const app = express();
const PORT = Number(process.env.PORT) || 5000;

// Allowed frontend origins
const allowedOrigins = [
  "http://localhost:5500",
  "http://127.0.0.1:5500",
  "http://localhost:3000",
  "http://127.0.0.1:3000"
];

// Make Prisma available to route handlers
app.locals.prisma = prisma;

// CORS configuration
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error("Origin not allowed by CORS"));
    }
  })
);

// Parse JSON request bodies
app.use(express.json({ limit: "1mb" }));

// Root endpoint
app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Welcome to the VentrixCarros API"
  });
});

// API health check
app.get("/api/v1/health", (req, res) => {
  res.json({
    success: true,
    status: "healthy",
    service: "VentrixCarros Backend"
  });
});

// Database health check
app.get("/api/v1/health/database", async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;

    return res.json({
      success: true,
      status: "connected",
      database: "MySQL",
      message: "Database connection successful"
    });
  } catch (error) {
    console.error("Database health check failed:", error.message);

    return res.status(503).json({
      success: false,
      status: "disconnected",
      database: "MySQL",
      message: "Database connection failed"
    });
  }
});

// API route registrations
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/profile", profileRoutes);
app.use("/api/v1/jobs", jobRoutes);
app.use("/api/v1/applications", applicationRoutes);
app.use("/api/v1/notifications", notificationRoutes);
app.use("/api/v1/contact", contactRoutes);

// API 404 handler
app.use("/api", (req, res) => {
  return res.status(404).json({
    success: false,
    message: "API route not found"
  });
});

// General 404 handler
app.use((req, res) => {
  return res.status(404).json({
    success: false,
    message: "Route not found"
  });
});

// Central error handler
app.use((err, req, res, next) => {
  console.error("API error:", err.message);

  if (res.headersSent) {
    return next(err);
  }

  return res.status(err.status || 500).json({
    success: false,
    message:
      err.status && err.status < 500
        ? err.message
        : "Internal server error"
  });
});

// Start server
async function startServer() {
  try {
    await prisma.$connect();

    console.log("MySQL database connected successfully");

    const server = app.listen(PORT, () => {
      console.log(
        `VentrixCarros API running at http://localhost:${PORT}`
      );

      console.log("\nAuthentication endpoints:");
      console.log("  POST /api/v1/auth/send-otp");
      console.log("  POST /api/v1/auth/verify-otp");
      console.log("  POST /api/v1/auth/signup");
      console.log("  POST /api/v1/auth/login");
      console.log("  POST /api/v1/auth/verify-login-otp");
      console.log("  POST /api/v1/auth/resend-login-otp");
      console.log("  GET  /api/v1/auth/me");

      console.log("\nProfile endpoints:");
      console.log("  GET  /api/v1/profile/me");
      console.log("  PUT  /api/v1/profile/me");

      console.log("\nJob endpoints:");
      console.log("  GET    /api/v1/jobs");
      console.log("  GET    /api/v1/jobs/:id");
      console.log("  GET    /api/v1/jobs/saved/me");
      console.log("  POST   /api/v1/jobs/:id/save");
      console.log("  DELETE /api/v1/jobs/:id/save");

      console.log("\nApplication endpoints:");
      console.log("  POST  /api/v1/applications");
      console.log("  GET   /api/v1/applications/me");
      console.log("  PATCH /api/v1/applications/:id/withdraw");

      console.log("\nNotification endpoints:");
      console.log("  GET   /api/v1/notifications");
      console.log("  PATCH /api/v1/notifications/read-all");
      console.log("  PATCH /api/v1/notifications/:id/read");

      console.log("\nContact endpoint:");
      console.log("  POST  /api/v1/contact");

      console.log("\nHealth endpoints:");
      console.log("  GET /api/v1/health");
      console.log("  GET /api/v1/health/database");
    });

    server.on("error", (error) => {
      if (error.code === "EADDRINUSE") {
        console.error(
          `Port ${PORT} is already in use. Stop the old server or choose another port.`
        );
      } else {
        console.error("HTTP server error:", error.message);
      }

      process.exitCode = 1;
    });

    let shuttingDown = false;

    async function shutdown() {
      if (shuttingDown) return;

      shuttingDown = true;

      console.log("\nShutting down VentrixCarros API...");

      server.close(async () => {
        try {
          await prisma.$disconnect();
          process.exit(0);
        } catch (error) {
          console.error("Database disconnect failed:", error.message);
          process.exitCode = 1;
        }
      });
    }

    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  } catch (error) {
    console.error(
      "Unable to start VentrixCarros API:",
      error.message
    );

    await prisma.$disconnect();
    process.exitCode = 1;
  }
}

startServer();
