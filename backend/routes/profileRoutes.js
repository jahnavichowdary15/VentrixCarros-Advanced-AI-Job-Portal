
const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const {
  authenticateToken,
  authorizeRoles
} = require("../middleware/authMiddleware");

const router = express.Router();

router.use(
  authenticateToken,
  authorizeRoles("JOB_SEEKER")
);

const uploadDirectory = path.join(
  __dirname,
  "..",
  "uploads",
  "profile-photos"
);

fs.mkdirSync(uploadDirectory, { recursive: true });

const allowedMimeTypes = [
  "image/jpeg",
  "image/png",
  "image/webp"
];

const storage = multer.diskStorage({
  destination: (req, file, callback) => {
    callback(null, uploadDirectory);
  },

  filename: (req, file, callback) => {
    const extension = {
      "image/jpeg": ".jpg",
      "image/png": ".png",
      "image/webp": ".webp"
    }[file.mimetype];

    callback(
      null,
      `${req.auth.userId}-${crypto.randomUUID()}${extension}`
    );
  }
});

const photoUpload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 1
  },
  fileFilter: (req, file, callback) => {
    if (!allowedMimeTypes.includes(file.mimetype)) {
      return callback(
        new Error("Only JPG, PNG and WEBP images are allowed.")
      );
    }

    callback(null, true);
  }
});

function handlePhotoUpload(req, res, next) {
  photoUpload.single("profilePhoto")(req, res, (error) => {
    if (error) {
      const message =
        error.code === "LIMIT_FILE_SIZE"
          ? "Image must be smaller than 5 MB."
          : error.message;

      return res.status(400).json({
        success: false,
        message
      });
    }

    next();
  });
}

const editableFields = [
  "fullName",
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
  "profilePicture",
  "preferredRole",
  "preferredLocation",
  "jobType",
  "githubUrl"
];

const profileFields = editableFields.filter(
  (field) => field !== "fullName"
);

const stringLimits = {
  fullName: 150,
  phone: 30,
  location: 150,
  headline: 200,
  bio: 5000,
  education: 5000,
  experience: 10000,
  resumeUrl: 2048,
  linkedinUrl: 2048,
  portfolioUrl: 2048,
  profilePicture: 2048,
  preferredRole: 150,
  preferredLocation: 150,
  jobType: 30,
  githubUrl: 2048
};

// GET /api/v1/profile/me
router.get("/me", async (req, res) => {
  try {
    const prisma = req.app.locals.prisma;

    const [user, profile] = await Promise.all([
      prisma.user.findUnique({
        where: {
          id: req.auth.userId
        },
        select: {
          name: true
        }
      }),

      prisma.profile.findUnique({
        where: {
          userId: req.auth.userId
        }
      })
    ]);

    return res.status(200).json({
      success: true,
      message: "Profile retrieved successfully.",
      profile: {
        ...(profile || {}),
        fullName: user?.name || ""
      }
    });

  } catch (error) {
    console.error("Get profile failed:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to retrieve your profile right now."
    });
  }
});

// POST /api/v1/profile/photo
router.post("/photo", handlePhotoUpload, async (req, res) => {
  let uploadedFilePath = null;

  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Please select a profile photo."
      });
    }

    uploadedFilePath = req.file.path;

    const prisma = req.app.locals.prisma;

    const existingProfile = await prisma.profile.findUnique({
      where: {
        userId: req.auth.userId
      }
    });

    const photoUrl =
      `/uploads/profile-photos/${req.file.filename}`;

    const profile = await prisma.profile.upsert({
      where: {
        userId: req.auth.userId
      },

      create: {
        userId: req.auth.userId,
        profilePicture: photoUrl
      },

      update: {
        profilePicture: photoUrl
      }
    });

    const oldPhoto = existingProfile?.profilePicture;

    if (
      oldPhoto &&
      oldPhoto.startsWith("/uploads/profile-photos/")
    ) {
      const oldFilename = path.basename(oldPhoto);
      const oldPath = path.join(uploadDirectory, oldFilename);

      if (oldPath !== uploadedFilePath && fs.existsSync(oldPath)) {
        fs.unlink(oldPath, (error) => {
          if (error) {
            console.error(
              "Old profile photo cleanup failed:",
              error.message
            );
          }
        });
      }
    }

    return res.status(200).json({
      success: true,
      message: "Profile photo uploaded successfully.",
      profilePicture: profile.profilePicture,
      profile
    });

  } catch (error) {
    console.error("Profile photo upload failed:", error);

    if (uploadedFilePath && fs.existsSync(uploadedFilePath)) {
      fs.unlink(uploadedFilePath, () => {});
    }

    return res.status(500).json({
      success: false,
      message: "Unable to upload your profile photo."
    });
  }
});

// PUT /api/v1/profile/me
router.put("/me", async (req, res) => {
  try {
    const prisma = req.app.locals.prisma;
    const body = req.body;

    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body)
    ) {
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
    let fullName;

    if (Object.prototype.hasOwnProperty.call(body, "fullName")) {
      if (typeof body.fullName !== "string") {
        return res.status(400).json({
          success: false,
          message: "fullName must be a string."
        });
      }

      fullName = body.fullName.trim();

      if (
        fullName.length === 0 ||
        fullName.length > stringLimits.fullName
      ) {
        return res.status(400).json({
          success: false,
          message: "Name must contain between 1 and 150 characters."
        });
      }
    }

    for (const field of profileFields) {
      if (!Object.prototype.hasOwnProperty.call(body, field)) {
        continue;
      }

      const value = body[field];

      if (field === "skills") {
        if (
          value !== null &&
          (
            !Array.isArray(value) ||
            value.length > 100 ||
            !value.every(
              (skill) =>
                typeof skill === "string" &&
                skill.trim().length > 0 &&
                skill.trim().length <= 100
            )
          )
        ) {
          return res.status(400).json({
            success: false,
            message: "Skills must be an array of up to 100 non-empty strings."
          });
        }

        data.skills =
          value === null
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

      data[field] =
        typeof value === "string"
          ? value.trim()
          : null;
    }

    const userId = req.auth.userId;

    const existingProfile = await prisma.profile.findUnique({
      where: {
        userId
      }
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

      return (
        typeof value === "string" &&
        value.trim().length > 0
      );
    }).length;

    data.completion = Math.round(
      (completedCount / completionFields.length) * 100
    );

    // Save the User name and Profile details together.
    const result = await prisma.$transaction(async (tx) => {
      if (fullName !== undefined) {
        await tx.user.update({
          where: {
            id: userId
          },
          data: {
            name: fullName
          }
        });
      }

      const profile = await tx.profile.upsert({
        where: {
          userId
        },

        create: {
          userId,
          ...data
        },

        update: data
      });

      const user = await tx.user.findUnique({
        where: {
          id: userId
        },
        select: {
          name: true
        }
      });

      return {
        ...profile,
        fullName: user?.name || ""
      };
    });

    return res.status(200).json({
      success: true,
      message: "Profile saved successfully.",
      profile: result
    });

  } catch (error) {
    console.error("Save profile failed:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to save your profile right now."
    });
  }
});

module.exports = router;
