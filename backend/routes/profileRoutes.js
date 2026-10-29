
const express = require("express");
const { authenticateToken, authorizeRoles } = require("../middleware/authMiddleware");

const router = express.Router();

// Only logged-in job seekers can use these endpoints.
router.use(authenticateToken, authorizeRoles("JOB_SEEKER"));

const editableFields = [
  "phone",
  "location",
  "headline",
  "bio",
  "skills",
  "education",
  "experience",
  "resumeUrl",
  "linkedinUrl",
  "portfolioUrl",
  "profilePicture"
];

const stringLimits = {
  phone: 30,
  location: 150,
  headline: 200,
  bio: 5000,
  education: 5000,
  experience: 10000,
  resumeUrl: 2048,
  linkedinUrl: 2048,
  portfolioUrl: 2048,
  profilePicture: 2048
};

// GET /api/v1/profile/me
// View the logged-in job seeker's profile.
router.get("/me", async (req, res) => {
  try {
    const prisma = req.app.locals.prisma;

    const profile = await prisma.profile.findUnique({
      where: { userId: req.auth.userId }
    });

    return res.status(200).json({
      success: true,
      message: "Profile retrieved successfully.",
      profile
    });
  } catch (error) {
    console.error("Get profile failed:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to retrieve your profile right now."
    });
  }
});


router.put("/me", async (req, res) => {
  try {
    const prisma = req.app.locals.prisma;
    const body = req.body;

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return res.status(400).json({
        success: false,
        message: "Please provide profile data."
      });
    }

    const unknownFields = Object.keys(body).filter(
      (field) => !editableFields.includes(field)
    );

    if (unknownFields.length > 0) {
      return res.status(400).json({
        success: false,
        message: "One or more profile fields are not editable.",
        fields: unknownFields
      });
    }

    const data = {};

    for (const field of editableFields) {
      if (!Object.prototype.hasOwnProperty.call(body, field)) {
        continue;
      }

      const value = body[field];

      if (field === "skills") {
        if (
          value !== null &&
          (!Array.isArray(value) ||
            !value.every(
              (skill) =>
                typeof skill === "string" &&
                skill.trim().length > 0 &&
                skill.trim().length <= 100
            ) ||
            value.length > 100)
        ) {
          return res.status(400).json({
            success: false,
            message: "Skills must be an array of up to 100 non-empty strings."
          });
        }

        data.skills = value === null
          ? null
          : [...new Set(value.map((skill) => skill.trim()))];

        continue;
      }

      if (value !== null && typeof value !== "string") {
        return res.status(400).json({
          success: false,
          message: `${field} must be a string or null.`
        });
      }

      if (
        typeof value === "string" &&
        value.trim().length > stringLimits[field]
      ) {
        return res.status(400).json({
          success: false,
          message: `${field} exceeds its maximum length of ${stringLimits[field]} characters.`
        });
      }

      data[field] = typeof value === "string" ? value.trim() : null;
    }

    const existingProfile = await prisma.profile.findUnique({
      where: { userId: req.auth.userId }
    });

    const merged = {
      ...(existingProfile || {}),
      ...data
    };

    const completionFields = [
      "phone",
      "location",
      "headline",
      "bio",
      "skills",
      "education",
      "experience",
      "resumeUrl",
      "linkedinUrl",
      "portfolioUrl",
      "profilePicture"
    ];

    const completedCount = completionFields.filter((field) => {
      const value = merged[field];

      if (field === "skills") {
        return Array.isArray(value) && value.length > 0;
      }

      return typeof value === "string" && value.trim().length > 0;
    }).length;

    data.completion = Math.round(
      (completedCount / completionFields.length) * 100
    );

    const profile = await prisma.profile.upsert({
      where: { userId: req.auth.userId },
      create: {
        userId: req.auth.userId,
        ...data
      },
      update: data
    });

    return res.status(200).json({
      success: true,
      message: "Profile saved successfully.",
      profile
    });
  } catch (error) {
    console.error("Save profile failed:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to save your profile right now."
    });
  }
});

module.exports = router;
