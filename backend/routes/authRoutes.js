
const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const { sendOtpEmail } = require("../services/emailService");

const router = express.Router();
const prisma = new PrismaClient();

const OTP_EXPIRY_MS = 5 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;

function normalizeEmail(email) {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

function hashOtp(email, otp) {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    throw new Error("JWT_SECRET is not configured.");
  }

  return crypto
    .createHmac("sha256", secret)
    .update(`${email}:${otp}`)
    .digest("hex");
}

function createToken(user) {
  return jwt.sign(
    { role: user.role },
    process.env.JWT_SECRET,
    {
      subject: String(user.id),
      expiresIn: "1d",
    }
  );
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    emailVerified: user.emailVerified,
  };
}

async function sendAndSaveOtp(email) {
  const now = new Date();
  const existing = await prisma.emailOtp.findUnique({
    where: { email },
  });

  if (
    existing &&
    now.getTime() - new Date(existing.createdAt).getTime() <
      RESEND_COOLDOWN_MS
  ) {
    const error = new Error("Please wait 60 seconds before requesting another OTP.");
    error.status = 429;
    throw error;
  }

  const otp = crypto.randomInt(100000, 1000000).toString();

  await sendOtpEmail(email, otp);

  await prisma.emailOtp.upsert({
    where: { email },
    create: {
      email,
      codeHash: hashOtp(email, otp),
      expiresAt: new Date(Date.now() + OTP_EXPIRY_MS),
      attempts: 0,
    },
    update: {
      codeHash: hashOtp(email, otp),
      expiresAt: new Date(Date.now() + OTP_EXPIRY_MS),
      attempts: 0,
      createdAt: new Date(),
    },
  });
}

async function checkOtp(email, otp) {
  const record = await prisma.emailOtp.findUnique({
    where: { email },
  });

  if (!record) {
    return { ok: false, message: "OTP not found. Please request a new OTP." };
  }

  if (new Date(record.expiresAt).getTime() < Date.now()) {
    await prisma.emailOtp.deleteMany({ where: { email } });
    return { ok: false, message: "OTP expired. Please request a new OTP." };
  }

  if (record.attempts >= MAX_OTP_ATTEMPTS) {
    await prisma.emailOtp.deleteMany({ where: { email } });
    return { ok: false, message: "Too many attempts. Please request a new OTP." };
  }

  const expected = hashOtp(email, otp);
  const actualBuffer = Buffer.from(record.codeHash, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");

  const matches =
    actualBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(actualBuffer, expectedBuffer);

  if (!matches) {
    await prisma.emailOtp.update({
      where: { email },
      data: { attempts: { increment: 1 } },
    });

    return { ok: false, message: "Invalid OTP. Please try again." };
  }

  await prisma.emailOtp.deleteMany({ where: { email } });
  return { ok: true };
}

// SIGNUP: send verification OTP
router.post("/send-otp", async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({
        success: false,
        message: "Please enter a valid email address.",
      });
    }

    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "An account with this email already exists.",
      });
    }

    await sendAndSaveOtp(email);

    return res.json({
      success: true,
      message: "Verification OTP sent to your email.",
      email,
    });
  } catch (error) {
    console.error("Send signup OTP failed:", error);
    return res.status(error.status || 500).json({
      success: false,
      message:
        error.status === 429
          ? error.message
          : "Unable to send the OTP. Please check the email configuration and try again.",
    });
  }
});

// SIGNUP: verify email OTP and issue temporary verification token
router.post("/verify-otp", async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const otp = String(req.body?.otp || "").trim();

    if (!email || !/^\d{6}$/.test(otp)) {
      return res.status(400).json({
        success: false,
        message: "Enter your email and the six-digit OTP.",
      });
    }

    const result = await checkOtp(email, otp);

    if (!result.ok) {
      return res.status(400).json({
        success: false,
        message: result.message,
      });
    }

    const verificationToken = jwt.sign(
      { email, purpose: "signup_email_verification" },
      process.env.JWT_SECRET,
      { expiresIn: "10m" }
    );

    return res.json({
      success: true,
      message: "Email verified successfully.",
      verificationToken,
    });
  } catch (error) {
    console.error("Verify signup OTP failed:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to verify the OTP right now.",
    });
  }
});

// SIGNUP: create user after email verification
router.post("/signup", async (req, res) => {
  try {
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    const email = normalizeEmail(req.body?.email);
    const password = req.body?.password;
    const role = req.body?.role;
    const verificationToken = req.body?.verificationToken;

    if (!name || !email || typeof password !== "string") {
      return res.status(400).json({
        success: false,
        message: "Name, email, and password are required.",
      });
    }

    if (password.length < 8 || password.length > 72) {
      return res.status(400).json({
        success: false,
        message: "Password must be between 8 and 72 characters.",
      });
    }

    if (!["JOB_SEEKER", "COMPANY"].includes(role)) {
      return res.status(400).json({
        success: false,
        message: "Please select a valid account type.",
      });
    }

    if (!verificationToken) {
      return res.status(400).json({
        success: false,
        message: "Please verify your email first.",
      });
    }

    let decoded;

    try {
      decoded = jwt.verify(verificationToken, process.env.JWT_SECRET);
    } catch {
      return res.status(400).json({
        success: false,
        message: "Email verification expired. Please verify your email again.",
      });
    }

    if (
      decoded.purpose !== "signup_email_verification" ||
      decoded.email !== email
    ) {
      return res.status(400).json({
        success: false,
        message: "Email verification does not match this email address.",
      });
    }

    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "An account with this email already exists.",
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: {
        name,
        email,
        passwordHash,
        role,
        emailVerified: true,
        isActive: true,
      },
    });

    return res.status(201).json({
      success: true,
      message: "Account created successfully.",
      token: createToken(user),
      user: publicUser(user),
    });
  } catch (error) {
    console.error("Signup failed:", error);

    if (error.code === "P2002") {
      return res.status(409).json({
        success: false,
        message: "An account with this email already exists.",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Unable to create your account right now.",
    });
  }
});

// LOGIN: check password and send OTP
router.post("/login", async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = req.body?.password;

    if (!email || typeof password !== "string" || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required.",
      });
    }

    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password.",
      });
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);

    if (!passwordMatches) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password.",
      });
    }

    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: "This account is disabled. Please contact support.",
      });
    }

    if (!user.emailVerified) {
      return res.status(403).json({
        success: false,
        message: "Please verify your email before logging in.",
      });
    }

    await sendAndSaveOtp(email);

    return res.json({
      success: true,
      otpRequired: true,
      email,
      message: "A login OTP has been sent to your email.",
    });
  } catch (error) {
    console.error("Login failed:", error);

    return res.status(error.status || 500).json({
      success: false,
      message:
        error.status === 429
          ? error.message
          : "Unable to log in right now. Please try again later.",
    });
  }
});

// LOGIN: verify OTP and return JWT
router.post("/verify-login-otp", async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const otp = String(req.body?.otp || "").trim();

    if (!email || !/^\d{6}$/.test(otp)) {
      return res.status(400).json({
        success: false,
        message: "Enter your email and the six-digit OTP.",
      });
    }

    const result = await checkOtp(email, otp);

    if (!result.ok) {
      return res.status(400).json({
        success: false,
        message: result.message,
      });
    }

    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user || !user.isActive || !user.emailVerified) {
      return res.status(401).json({
        success: false,
        message: "Unable to complete login. Please log in again.",
      });
    }

    return res.json({
      success: true,
      message: "Login successful.",
      token: createToken(user),
      user: publicUser(user),
    });
  } catch (error) {
    console.error("Verify login OTP failed:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to verify the login OTP right now.",
    });
  }
});

// LOGIN: resend OTP after password check
router.post("/resend-login-otp", async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = req.body?.password;

    if (!email || typeof password !== "string" || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required.",
      });
    }

    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (
      !user ||
      !(await bcrypt.compare(password, user.passwordHash)) ||
      !user.isActive ||
      !user.emailVerified
    ) {
      return res.status(401).json({
        success: false,
        message: "Unable to resend OTP. Please check your login details.",
      });
    }

    await sendAndSaveOtp(email);

    return res.json({
      success: true,
      message: "A new OTP has been sent to your email.",
      email,
    });
  } catch (error) {
    console.error("Resend login OTP failed:", error);
    return res.status(error.status || 500).json({
      success: false,
      message:
        error.status === 429
          ? error.message
          : "Unable to resend the OTP right now.",
    });
  }
});

/* CHANGE PASSWORD: update the authenticated user's password in MySQL */
router.put("/change-password", async (req, res) => {
  try {
    const authorization = req.headers.authorization || "";
    const token = authorization.startsWith("Bearer ")
      ? authorization.slice(7)
      : "";

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Please log in again to change your password."
      });
    }

    let decoded;

    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      return res.status(401).json({
        success: false,
        message: "Your session has expired. Please log in again."
      });
    }

    const currentPassword = req.body?.currentPassword;
    const newPassword = req.body?.newPassword;

    if (
      typeof currentPassword !== "string" ||
      typeof newPassword !== "string" ||
      !currentPassword ||
      !newPassword
    ) {
      return res.status(400).json({
        success: false,
        message: "Current password and new password are required."
      });
    }

    if (newPassword.length < 8 || newPassword.length > 72) {
      return res.status(400).json({
        success: false,
        message: "New password must be between 8 and 72 characters."
      });
    }

    if (currentPassword === newPassword) {
      return res.status(400).json({
        success: false,
        message: "Your new password must be different from your current password."
      });
    }

    // Token subject is the user's String ID (CUID).
    const user = await prisma.user.findUnique({
      where: { id: String(decoded.sub) }
    });

    if (!user || !user.isActive) {
      return res.status(401).json({
        success: false,
        message: "Your account could not be verified."
      });
    }

    const passwordMatches = await bcrypt.compare(
      currentPassword,
      user.passwordHash
    );

    if (!passwordMatches) {
      return res.status(400).json({
        success: false,
        message: "Your current password is incorrect."
      });
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash }
    });

    return res.json({
      success: true,
      message: "Password changed successfully. Use your new password next time you log in."
    });
  } catch (error) {
    console.error("Change password failed:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to change your password right now. Please try again."
    });
  }
});

// GET current authenticated user
router.get("/me", async (req, res) => {
  try {
    const authorization = req.headers.authorization || "";
    const token = authorization.startsWith("Bearer ")
      ? authorization.slice(7)
      : "";

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Authentication token is required.",
      });
    }

    let decoded;

    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      return res.status(401).json({
        success: false,
        message: "Invalid or expired authentication token.",
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: Number(decoded.sub) },
    });

    if (!user || !user.isActive) {
      return res.status(401).json({
        success: false,
        message: "User account not found or disabled.",
      });
    }

    return res.json({
      success: true,
      user: publicUser(user),
    });
  } catch (error) {
    console.error("Get current user failed:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to retrieve your account right now.",
    });
  }
});

module.exports = router;
