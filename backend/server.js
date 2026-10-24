
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { PrismaClient } = require("@prisma/client");

const authRoutes = require("./routes/authRoutes");
const profileRoutes = require("./routes/profileRoutes");
const jobRoutes = require("./routes/jobRoutes");
const applicationRoutes = require("./routes/applicationRoutes");

const app = express();
const prisma = new PrismaClient();

const PORT = Number(process.env.PORT) || 5000;

// Allow the local frontend development servers.
const allowedOrigins = [
  "http://localhost:5500",
  "http://127.0.0.1:5500",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];

app.locals.prisma = prisma;

// Middleware
app.use(
  cors({
    origin(origin, callback) {
      // Requests from PowerShell and other non-browser clients
      // commonly have no Origin header.
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error("Origin not allowed by CORS"));
    },
  })
);

app.use(express.json({ limit: "1mb" }));

// Root endpoint
app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Welcome to the VentrixCarros API",
  });
});

// API health check
app.get("/api/v1/health", (req, res) => {
  res.json({
    success: true,
    status: "healthy",
    service: "VentrixCarros Backend",
  });
});

// Database health check
app.get("/api/v1/health/database", async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;

    res.json({
      success: true,
      status: "connected",
      database: "MySQL",
      message: "Database connection successful",
    });
  } catch (error) {
    console.error("Database health check failed:", error.message);

    res.status(503).json({
      success: false,
      status: "disconnected",
      database: "MySQL",
      message: "Database connection failed",
    });
  }
});

// API routes
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/profile", profileRoutes);
app.use("/api/v1/jobs", jobRoutes);
app.use("/api/v1/applications", applicationRoutes);

// Handle unknown API routes
app.use("/api", (req, res) => {
  res.status(404).json({
    success: false,
    message: "API route not found",
  });
});

// Handle other unknown routes
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
  });
});

// Central error handler
app.use((err, req, res, next) => {
  console.error("API error:", err.message);

  if (res.headersSent) {
    return next(err);
  }

  res.status(err.status || 500).json({
    success: false,
    message:
      err.status && err.status < 500
        ? err.message
        : "Internal server error",
  });
});

// Start the server after connecting to MySQL.
async function startServer() {
  try {
    await prisma.$connect();
    console.log("MySQL database connected successfully");

    const server = app.listen(PORT, () => {
      console.log(
        `VentrixCarros API running at http://localhost:${PORT}`
      );
      console.log(
        "Email OTP endpoints: /api/v1/auth/send-otp and /api/v1/auth/verify-otp"
      );
      console.log(
        "Applications endpoint: /api/v1/applications"
      );
    });

    server.on("error", (error) => {
      if (error.code === "EADDRINUSE") {
        console.error(
          `Port ${PORT} is already in use. Stop the old server or choose another port.`
        );
      } else {
        console.error("HTTP server error:", error.message);
      }

      process.exit(1);
    });

    // Disconnect cleanly when the server is stopped.
    const shutdown = async () => {
      console.log("\nShutting down VentrixCarros API...");

      server.close(async () => {
        await prisma.$disconnect();
        process.exit(0);
      });
    };

    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  } catch (error) {
    console.error("Unable to start VentrixCarros API:", error.message);
    await prisma.$disconnect();
    process.exit(1);
  }
}

startServer();
