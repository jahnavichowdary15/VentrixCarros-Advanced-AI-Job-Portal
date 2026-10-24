const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { rateLimit } = require("express-rate-limit");
const { PrismaClient } = require("@prisma/client");
const { sendOtpEmail } = require("../services/emailService");
const {
  authenticateToken
} = require("../middleware/authMiddleware");

const router = express.Router();
const prisma = new PrismaClient();

const OTP_EXPIRY_MS = 5 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_VERIFY_ATTEMPTS = 5;
const SIGNUP_TOKEN_EXPIRY = "10m";
const LOGIN_TOKEN_EXPIRY = "1d";
const ALLOWED_SIGNUP_ROLES = ["JOB_SEEKER", "COMPANY"];

function normalizeEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;

  if (!secret || secret.length < 32) {
    const error = new Error(
      "JWT_SECRET must be configured with at least 32 characters."
    );
    error.code = "JWT_SECRET_MISSING_OR_WEAK";
    throw error;
  }

  return secret;
}

function hashOtp(email, otp) {
  return crypto
    .createHmac("sha256", getJwtSecret())
    .update(`${email}:${otp}`)
    .digest("hex");
}

function safeCompareHashes(first, second) {
  if (
    typeof first !== "string" ||
    typeof second !== "string" ||
    !/^[a-f0-9]{64}$/i.test(first) ||
    !/^[a-f0-9]{64}$/i.test(second)
  ) {
    return false;
  }

  return crypto.timingSafeEqual(
    Buffer.from(first, "hex"),
    Buffer.from(second, "hex")
  );
}

function logAuthError(action, error) {
  // Never log passwords, OTPs, JWTs, or environment secrets.
  console.error(`${action} failed:`, {
    name: error?.name,
    code: error?.code
  });
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    emailVerified: user.emailVerified,
    createdAt: user.createdAt
  };
}

const sendOtpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many OTP requests. Please try again later."
  }
});

const verifyOtpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many verification requests. Please try again later."
  }
});

const signupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many signup attempts. Please try again later."
  }
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many login attempts. Please try again later."
  }
});

// POST /api/v1/auth/send-otp
router.post("/send-otp", sendOtpLimiter, async (req, res) => {
  const email = normalizeEmail(req.body?.email);

  if (!isValidEmail(email)) {
    return res.status(400).json({
      success: false,
      message: "Please provide a valid email address."
    });
  }

  try {
    const existingUser = await prisma.user.findUnique({
      where: { email },
      select: { id: true }
    });

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "An account with this email already exists. Please log in."
      });
    }

    const existingOtp = await prisma.emailOtp.findUnique({
      where: { email }
    });

    if (
      existingOtp &&
      Date.now() - existingOtp.createdAt.getTime() < RESEND_COOLDOWN_MS
    ) {
      const remainingSeconds = Math.ceil(
        (
          RESEND_COOLDOWN_MS -
          (Date.now() - existingOtp.createdAt.getTime())
        ) / 1000
      );

      return res.status(429).json({
        success: false,
        message: `Please wait ${remainingSeconds} seconds before requesting another OTP.`
      });
    }

    const otp = crypto.randomInt(100000, 1000000).toString();
    const codeHash = hashOtp(email, otp);
    const now = new Date();

    // Save the OTP only after the email has been sent successfully.
    await sendOtpEmail(email, otp);

    await prisma.emailOtp.upsert({
      where: { email },
      create: {
        email,
        codeHash,
        expiresAt: new Date(now.getTime() + OTP_EXPIRY_MS),
        attempts: 0
      },
      update: {
        codeHash,
        expiresAt: new Date(now.getTime() + OTP_EXPIRY_MS),
        attempts: 0,
        createdAt: now
      }
    });

    return res.status(200).json({
      success: true,
      message: "OTP sent successfully. Please check your email.",
      expiresInSeconds: 300
    });
  } catch (error) {
    logAuthError("Send OTP", error);

    return res.status(500).json({
      success: false,
      message: "Unable to send the OTP. Please try again later."
    });
  }
});

// POST /api/v1/auth/verify-otp
router.post("/verify-otp", verifyOtpLimiter, async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const otp =
    typeof req.body?.otp === "string"
      ? req.body.otp.trim()
      : typeof req.body?.code === "string"
        ? req.body.code.trim()
        : "";

  if (!isValidEmail(email) || !/^\d{6}$/.test(otp)) {
    return res.status(400).json({
      success: false,
      message: "Please provide a valid email and six-digit OTP."
    });
  }

  try {
    const record = await prisma.emailOtp.findUnique({
      where: { email }
    });

    if (!record) {
      return res.status(400).json({
        success: false,
        message: "OTP is invalid or expired. Please request a new one."
      });
    }

    if (record.expiresAt.getTime() <= Date.now()) {
      await prisma.emailOtp.deleteMany({ where: { email } });

      return res.status(400).json({
        success: false,
        message: "OTP has expired. Please request a new one."
      });
    }

    if (record.attempts >= MAX_VERIFY_ATTEMPTS) {
      await prisma.emailOtp.deleteMany({ where: { email } });

      return res.status(429).json({
        success: false,
        message: "Too many incorrect attempts. Please request a new OTP."
      });
    }

    const submittedHash = hashOtp(email, otp);

    if (!safeCompareHashes(record.codeHash, submittedHash)) {
      const updated = await prisma.emailOtp.update({
        where: { email },
        data: { attempts: { increment: 1 } }
      });

      if (updated.attempts >= MAX_VERIFY_ATTEMPTS) {
        await prisma.emailOtp.deleteMany({ where: { email } });
      }

      return res.status(400).json({
        success: false,
        message: "Incorrect OTP. Please check the code and try again."
      });
    }

    const verificationToken = jwt.sign(
      {
        email,
        purpose: "signup_email_verification"
      },
      getJwtSecret(),
      { expiresIn: SIGNUP_TOKEN_EXPIRY }
    );

    await prisma.emailOtp.deleteMany({ where: { email } });

    return res.status(200).json({
      success: true,
      verified: true,
      email,
      verificationToken,
      expiresIn: SIGNUP_TOKEN_EXPIRY,
      message: "Email verified. You can now complete signup."
    });
  } catch (error) {
    logAuthError("Verify OTP", error);

    return res.status(500).json({
      success: false,
      message: "Unable to verify the OTP right now. Please try again."
    });
  }
});

// POST /api/v1/auth/signup
router.post("/signup", signupLimiter, async (req, res) => {
  const name =
    typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const email = normalizeEmail(req.body?.email);
  const password = req.body?.password;
  const role =
    typeof req.body?.role === "string"
      ? req.body.role.trim().toUpperCase()
      : "JOB_SEEKER";
  const verificationToken = req.body?.verificationToken;

  if (name.length < 2 || name.length > 100) {
    return res.status(400).json({
      success: false,
      message: "Name must be between 2 and 100 characters."
    });
  }

  if (!isValidEmail(email)) {
    return res.status(400).json({
      success: false,
      message: "Please provide a valid email address."
    });
  }

  if (
    typeof password !== "string" ||
    password.length < 8 ||
    password.length > 72
  ) {
    return res.status(400).json({
      success: false,
      message: "Password must be between 8 and 72 characters."
    });
  }

  if (!ALLOWED_SIGNUP_ROLES.includes(role)) {
    return res.status(400).json({
      success: false,
      message: "Role must be JOB_SEEKER or COMPANY."
    });
  }

  if (
    typeof verificationToken !== "string" ||
    verificationToken.length === 0
  ) {
    return res.status(400).json({
      success: false,
      message: "Verify your email with an OTP before signing up."
    });
  }

  try {
    const claims = jwt.verify(verificationToken, getJwtSecret());

    if (
      typeof claims !== "object" ||
      claims.purpose !== "signup_email_verification" ||
      claims.email !== email
    ) {
      return res.status(401).json({
        success: false,
        message: "Email verification is invalid. Please verify your email again."
      });
    }

    const existingUser = await prisma.user.findUnique({
      where: { email },
      select: { id: true }
    });

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "An account with this email already exists. Please log in."
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: {
        name,
        email,
        passwordHash,
        role,
        emailVerified: true
      }
    });

    return res.status(201).json({
      success: true,
      message: "Account created successfully. You can now log in.",
      user: publicUser(user)
    });
  } catch (error) {
    if (
      error?.name === "TokenExpiredError" ||
      error?.name === "JsonWebTokenError" ||
      error?.name === "NotBeforeError"
    ) {
      return res.status(401).json({
        success: false,
        message: "Email verification token is invalid or expired. Please verify your email again."
      });
    }

    if (error?.code === "P2002") {
      return res.status(409).json({
        success: false,
        message: "An account with this email already exists. Please log in."
      });
    }

    logAuthError("Signup", error);

    return res.status(500).json({
      success: false,
      message: "Unable to create your account right now."
    });
  }
});

// POST /api/v1/auth/login
router.post("/login", loginLimiter, async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = req.body?.password;

  if (
    !isValidEmail(email) ||
    typeof password !== "string" ||
    password.length === 0 ||
    password.length > 72
  ) {
    return res.status(400).json({
      success: false,
      message: "Please provide a valid email and password."
    });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { email }
    });

    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password."
      });
    }

    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: "This account is inactive. Please contact support."
      });
    }

    if (!user.emailVerified) {
      return res.status(403).json({
        success: false,
        message: "Please verify your email before logging in."
      });
    }

    const token = jwt.sign(
      { role: user.role },
      getJwtSecret(),
      {
        subject: user.id,
        expiresIn: LOGIN_TOKEN_EXPIRY
      }
    );

    return res.status(200).json({
      success: true,
      message: "Login successful.",
      token,
      tokenType: "Bearer",
      expiresIn: LOGIN_TOKEN_EXPIRY,
      user: publicUser(user)
    });
  } catch (error) {
    logAuthError("Login", error);

    return res.status(500).json({
      success: false,
      message: "Unable to log in right now. Please try again."
    });
  }
});

// GET /api/v1/auth/me
// Protected: requires a valid JWT from the login endpoint.
router.get("/me", authenticateToken, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: {
        id: req.auth.userId
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        emailVerified: true,
        isActive: true,
        createdAt: true
      }
    });

    if (!user || !user.isActive) {
      return res.status(401).json({
        success: false,
        message: "Your account is unavailable. Please log in again."
      });
    }

    return res.status(200).json({
      success: true,
      message: "Authenticated user retrieved successfully.",
      user
    });
  } catch (error) {
    logAuthError("Get authenticated user", error);

    return res.status(500).json({
      success: false,
      message: "Unable to retrieve your account right now."
    });
  }
});

module.exports = router;