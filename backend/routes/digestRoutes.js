
const express = require("express");

const {
  authenticateToken,
  authorizeRoles
} = require("../middleware/authMiddleware");

const { prisma } = require("../config/db");

const {
  sendTestDigestForUser
} = require("../services/jobDigestService");

const router = express.Router();

// All digest routes require an authenticated student.
router.use(authenticateToken);
router.use(authorizeRoles("JOB_SEEKER"));

/**
 * GET /api/v1/digest/preferences
 * Get the current student's digest settings.
 */
router.get("/preferences", async (req, res) => {
  try {
    const preference = await prisma.jobDigestPreference.findUnique({
      where: {
        userId: req.auth.userId
      }
    });

    return res.status(200).json({
      success: true,
      preferences: preference || {
        enabled: false,
        sendTime: "08:00",
        timezone: "Asia/Kolkata",
        lastSentAt: null
      }
    });
  } catch (error) {
    console.error("Get digest preferences error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to retrieve digest preferences."
    });
  }
});

/**
 * PUT /api/v1/digest/preferences
 * Enable or disable the daily digest and update its send time.
 */
router.put("/preferences", async (req, res) => {
  try {
    const { enabled, sendTime } = req.body;

    if (typeof enabled !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "The enabled field must be true or false."
      });
    }

    const selectedTime = sendTime || "08:00";

    if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(selectedTime)) {
      return res.status(400).json({
        success: false,
        message: "Send time must use HH:mm format."
      });
    }

    const now = new Date();

    const preference = await prisma.jobDigestPreference.upsert({
      where: {
        userId: req.auth.userId
      },
      create: {
        userId: req.auth.userId,
        enabled,
        sendTime: selectedTime,
        timezone: "Asia/Kolkata",
        enabledAt: enabled ? now : null
      },
      update: {
        enabled,
        sendTime: selectedTime,
        timezone: "Asia/Kolkata",
        enabledAt: enabled ? now : null
      }
    });

    return res.status(200).json({
      success: true,
      message: enabled
        ? "Daily job digest enabled successfully."
        : "Daily job digest disabled successfully.",
      preferences: preference
    });
  } catch (error) {
    console.error("Update digest preferences error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to update digest preferences."
    });
  }
});

/**
 * POST /api/v1/digest/test
 * Send a test digest to the logged-in student's own email.
 */
router.post("/test", async (req, res) => {
  try {
    const result = await sendTestDigestForUser(req.auth.userId);

    if (!result.success) {
      return res.status(500).json(result);
    }

    return res.status(200).json(result);
  } catch (error) {
    console.error("Test digest route failed:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to send the test digest."
    });
  }
});

module.exports = router;
