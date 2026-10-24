const express = require("express");
const {
  authenticateToken,
  authorizeRoles
} = require("../middleware/authMiddleware");

const router = express.Router();

function activeJobFilter() {
  return {
    isActive: true,
    OR: [
      { expiresAt: null },
      { expiresAt: { gt: new Date() } }
    ]
  };
}

const jobInclude = {
  company: {
    select: {
      id: true,
      name: true
    }
  }
};

/* =========================================
   JOB SEEKER: APPLY FOR A JOB
   POST /api/v1/applications
========================================= */

router.post(
  "/",
  authenticateToken,
  authorizeRoles("JOB_SEEKER"),
  async (req, res, next) => {
    try {
      const prisma = req.app.locals.prisma;

      const { jobId, coverLetter, resumeUrl } = req.body;

      if (typeof jobId !== "string" || !jobId.trim()) {
        return res.status(400).json({
          success: false,
          message: "A valid jobId is required."
        });
      }

      if (
        coverLetter !== undefined &&
        coverLetter !== null &&
        typeof coverLetter !== "string"
      ) {
        return res.status(400).json({
          success: false,
          message: "Cover letter must be text."
        });
      }

      if (
        resumeUrl !== undefined &&
        resumeUrl !== null &&
        typeof resumeUrl !== "string"
      ) {
        return res.status(400).json({
          success: false,
          message: "resumeUrl must be a string."
        });
      }

      const job = await prisma.job.findFirst({
        where: {
          id: jobId.trim(),
          ...activeJobFilter()
        },
        select: {
          id: true
        }
      });

      if (!job) {
        return res.status(404).json({
          success: false,
          message: "Job not found or is no longer available."
        });
      }

      const existingApplication = await prisma.application.findUnique({
        where: {
          userId_jobId: {
            userId: req.auth.userId,
            jobId: job.id
          }
        }
      });

      if (existingApplication) {
        return res.status(409).json({
          success: false,
          message: "You have already applied for this job.",
          application: existingApplication
        });
      }

      const application = await prisma.application.create({
        data: {
          userId: req.auth.userId,
          jobId: job.id,
          coverLetter: coverLetter?.trim() || null,
          resumeUrl: resumeUrl?.trim() || null
        },
        include: {
          job: {
            include: jobInclude
          }
        }
      });

      return res.status(201).json({
        success: true,
        message: "Application submitted successfully.",
        application
      });
    } catch (error) {
      // Handle two simultaneous attempts to apply for the same job.
      if (error.code === "P2002") {
        return res.status(409).json({
          success: false,
          message: "You have already applied for this job."
        });
      }

      return next(error);
    }
  }
);

/* =========================================
   JOB SEEKER: VIEW MY APPLICATIONS
   GET /api/v1/applications/me
========================================= */

router.get(
  "/me",
  authenticateToken,
  authorizeRoles("JOB_SEEKER"),
  async (req, res, next) => {
    try {
      const prisma = req.app.locals.prisma;

      const applications = await prisma.application.findMany({
        where: {
          userId: req.auth.userId
        },
        include: {
          job: {
            include: jobInclude
          }
        },
        orderBy: {
          appliedAt: "desc"
        }
      });

      return res.json({
        success: true,
        message: "Your applications were retrieved successfully.",
        applications,
        total: applications.length
      });
    } catch (error) {
      return next(error);
    }
  }
);

/* =========================================
   JOB SEEKER: WITHDRAW AN APPLICATION
   PATCH /api/v1/applications/:id/withdraw
========================================= */

router.patch(
  "/:id/withdraw",
  authenticateToken,
  authorizeRoles("JOB_SEEKER"),
  async (req, res, next) => {
    try {
      const prisma = req.app.locals.prisma;

      const application = await prisma.application.findFirst({
        where: {
          id: req.params.id,
          userId: req.auth.userId
        }
      });

      if (!application) {
        return res.status(404).json({
          success: false,
          message: "Application not found."
        });
      }

      if (application.status === "WITHDRAWN") {
        return res.status(409).json({
          success: false,
          message: "This application has already been withdrawn."
        });
      }

      if (
        application.status === "REJECTED" ||
        application.status === "OFFERED"
      ) {
        return res.status(400).json({
          success: false,
          message: "This application cannot be withdrawn in its current status."
        });
      }

      const updatedApplication = await prisma.application.update({
        where: {
          id: application.id
        },
        data: {
          status: "WITHDRAWN"
        },
        include: {
          job: {
            include: jobInclude
          }
        }
      });

      return res.json({
        success: true,
        message: "Application withdrawn successfully.",
        application: updatedApplication
      });
    } catch (error) {
      return next(error);
    }
  }
);

module.exports = router;
