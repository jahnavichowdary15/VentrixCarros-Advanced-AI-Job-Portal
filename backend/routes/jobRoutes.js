const express = require("express");
const { authenticateToken, authorizeRoles } = require("../middleware/authMiddleware");

const router = express.Router();

const VALID_JOB_TYPES = [
  "FULL_TIME",
  "PART_TIME",
  "INTERNSHIP",
  "CONTRACT",
  "REMOTE"
];

function isValidSalary(value) {
  return value === undefined ||
    value === null ||
    (Number.isInteger(value) && value >= 0);
}

function getPagination(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function activeJobFilter() {
  return {
    isActive: true,
    OR: [
      { expiresAt: null },
      { expiresAt: { gt: new Date() } }
    ]
  };
}

function publicJobInclude() {
  return {
    company: {
      select: {
        id: true,
        name: true
      }
    }
  };
}

/* =========================================
   PUBLIC: GET ALL ACTIVE JOBS
   GET /api/v1/jobs
========================================= */

router.get("/", async (req, res, next) => {
  try {
    const prisma = req.app.locals.prisma;

    const page = getPagination(req.query.page, 1);
    const limit = Math.min(getPagination(req.query.limit, 10), 50);
    const skip = (page - 1) * limit;

    const q = typeof req.query.q === "string"
      ? req.query.q.trim()
      : "";

    const location = typeof req.query.location === "string"
      ? req.query.location.trim()
      : "";

    const jobType = typeof req.query.jobType === "string"
      ? req.query.jobType.trim().toUpperCase()
      : "";

    if (jobType && !VALID_JOB_TYPES.includes(jobType)) {
      return res.status(400).json({
        success: false,
        message: "Invalid jobType. Use FULL_TIME, PART_TIME, INTERNSHIP, CONTRACT, or REMOTE."
      });
    }

    const where = {
      ...activeJobFilter(),
      ...(jobType ? { jobType } : {}),
      ...(location
        ? {
            location: {
              contains: location
            }
          }
        : {}),
      ...(q
        ? {
            OR: [
              { title: { contains: q } },
              { description: { contains: q } },
              { requirements: { contains: q } }
            ]
          }
        : {})
    };

    const [jobs, total] = await Promise.all([
      prisma.job.findMany({
        where,
        include: publicJobInclude(),
        orderBy: {
          createdAt: "desc"
        },
        skip,
        take: limit
      }),
      prisma.job.count({ where })
    ]);

    return res.json({
      success: true,
      message: "Jobs retrieved successfully.",
      jobs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    return next(error);
  }
});

/* =========================================
   JOB SEEKER: GET SAVED JOBS
   GET /api/v1/jobs/saved/me
========================================= */

router.get(
  "/saved/me",
  authenticateToken,
  authorizeRoles("JOB_SEEKER"),
  async (req, res, next) => {
    try {
      const prisma = req.app.locals.prisma;

      const savedJobs = await prisma.savedJob.findMany({
        where: {
          userId: req.auth.userId
        },
        orderBy: {
          createdAt: "desc"
        },
        include: {
          job: {
            include: publicJobInclude()
          }
        }
      });

      return res.json({
        success: true,
        message: "Saved jobs retrieved successfully.",
        jobs: savedJobs.map((saved) => ({
          savedAt: saved.createdAt,
          ...saved.job
        }))
      });
    } catch (error) {
      return next(error);
    }
  }
);

/* =========================================
   JOB SEEKER: SAVE A JOB
   POST /api/v1/jobs/:id/save
========================================= */

router.post(
  "/:id/save",
  authenticateToken,
  authorizeRoles("JOB_SEEKER"),
  async (req, res, next) => {
    try {
      const prisma = req.app.locals.prisma;
      const jobId = req.params.id;

      const job = await prisma.job.findFirst({
        where: {
          id: jobId,
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

      const savedJob = await prisma.savedJob.upsert({
        where: {
          userId_jobId: {
            userId: req.auth.userId,
            jobId
          }
        },
        update: {},
        create: {
          userId: req.auth.userId,
          jobId
        }
      });

      return res.status(200).json({
        success: true,
        message: "Job saved successfully.",
        savedJob
      });
    } catch (error) {
      return next(error);
    }
  }
);

/* =========================================
   JOB SEEKER: REMOVE A SAVED JOB
   DELETE /api/v1/jobs/:id/save
========================================= */

router.delete(
  "/:id/save",
  authenticateToken,
  authorizeRoles("JOB_SEEKER"),
  async (req, res, next) => {
    try {
      const prisma = req.app.locals.prisma;

      const result = await prisma.savedJob.deleteMany({
        where: {
          userId: req.auth.userId,
          jobId: req.params.id
        }
      });

      if (result.count === 0) {
        return res.status(404).json({
          success: false,
          message: "This job is not in your saved jobs."
        });
      }

      return res.json({
        success: true,
        message: "Job removed from saved jobs."
      });
    } catch (error) {
      return next(error);
    }
  }
);

/* =========================================
   PUBLIC: GET ONE ACTIVE JOB
   GET /api/v1/jobs/:id
========================================= */

router.get("/:id", async (req, res, next) => {
  try {
    const prisma = req.app.locals.prisma;

    const job = await prisma.job.findFirst({
      where: {
        id: req.params.id,
        ...activeJobFilter()
      },
      include: publicJobInclude()
    });

    if (!job) {
      return res.status(404).json({
        success: false,
        message: "Job not found or is no longer available."
      });
    }

    return res.json({
      success: true,
      message: "Job retrieved successfully.",
      job
    });
  } catch (error) {
    return next(error);
  }
});

/* =========================================
   COMPANY: CREATE A JOB
   POST /api/v1/jobs
========================================= */

router.post(
  "/",
  authenticateToken,
  authorizeRoles("COMPANY"),
  async (req, res, next) => {
    try {
      const prisma = req.app.locals.prisma;

      const {
        title,
        description,
        requirements,
        location,
        workMode,
        jobType,
        salaryMin,
        salaryMax,
        salaryCurrency,
        expiresAt
      } = req.body;

      if (
        typeof title !== "string" ||
        !title.trim() ||
        typeof description !== "string" ||
        !description.trim()
      ) {
        return res.status(400).json({
          success: false,
          message: "Job title and description are required."
        });
      }

      if (
        jobType !== undefined &&
        !VALID_JOB_TYPES.includes(jobType)
      ) {
        return res.status(400).json({
          success: false,
          message: "Invalid jobType."
        });
      }

      if (
        !isValidSalary(salaryMin) ||
        !isValidSalary(salaryMax)
      ) {
        return res.status(400).json({
          success: false,
          message: "Salary values must be non-negative whole numbers."
        });
      }

      if (
        salaryMin != null &&
        salaryMax != null &&
        salaryMin > salaryMax
      ) {
        return res.status(400).json({
          success: false,
          message: "Minimum salary cannot exceed maximum salary."
        });
      }

      let parsedExpiry;

      if (expiresAt !== undefined && expiresAt !== null && expiresAt !== "") {
        parsedExpiry = new Date(expiresAt);

        if (
          Number.isNaN(parsedExpiry.getTime()) ||
          parsedExpiry <= new Date()
        ) {
          return res.status(400).json({
            success: false,
            message: "expiresAt must be a valid future date."
          });
        }
      }

      const job = await prisma.job.create({
        data: {
          companyId: req.auth.userId,
          title: title.trim(),
          description: description.trim(),
          requirements: requirements ?? null,
          location: location ?? null,
          workMode: workMode ?? null,
          jobType: jobType || "FULL_TIME",
          salaryMin: salaryMin ?? null,
          salaryMax: salaryMax ?? null,
          salaryCurrency: salaryCurrency || "INR",
          ...(parsedExpiry ? { expiresAt: parsedExpiry } : {})
        },
        include: publicJobInclude()
      });

      return res.status(201).json({
        success: true,
        message: "Job created successfully.",
        job
      });
    } catch (error) {
      return next(error);
    }
  }
);

/* =========================================
   COMPANY: UPDATE OWN JOB
   PUT /api/v1/jobs/:id
========================================= */

router.put(
  "/:id",
  authenticateToken,
  authorizeRoles("COMPANY"),
  async (req, res, next) => {
    try {
      const prisma = req.app.locals.prisma;
      const jobId = req.params.id;

      const existingJob = await prisma.job.findFirst({
        where: {
          id: jobId,
          companyId: req.auth.userId
        }
      });

      if (!existingJob) {
        return res.status(404).json({
          success: false,
          message: "Job not found or you do not have permission to update it."
        });
      }

      const allowedFields = [
        "title",
        "description",
        "requirements",
        "location",
        "workMode",
        "jobType",
        "salaryMin",
        "salaryMax",
        "salaryCurrency",
        "isActive"
      ];

      const data = {};

      for (const field of allowedFields) {
        if (req.body[field] !== undefined) {
          data[field] = req.body[field];
        }
      }

      if (data.title !== undefined) {
        if (typeof data.title !== "string" || !data.title.trim()) {
          return res.status(400).json({
            success: false,
            message: "Job title cannot be empty."
          });
        }

        data.title = data.title.trim();
      }

      if (data.description !== undefined) {
        if (
          typeof data.description !== "string" ||
          !data.description.trim()
        ) {
          return res.status(400).json({
            success: false,
            message: "Job description cannot be empty."
          });
        }

        data.description = data.description.trim();
      }

      if (
        data.jobType !== undefined &&
        !VALID_JOB_TYPES.includes(data.jobType)
      ) {
        return res.status(400).json({
          success: false,
          message: "Invalid jobType."
        });
      }

      if (
        !isValidSalary(data.salaryMin) ||
        !isValidSalary(data.salaryMax)
      ) {
        return res.status(400).json({
          success: false,
          message: "Salary values must be non-negative whole numbers."
        });
      }

      const nextMin = data.salaryMin !== undefined
        ? data.salaryMin
        : existingJob.salaryMin;

      const nextMax = data.salaryMax !== undefined
        ? data.salaryMax
        : existingJob.salaryMax;

      if (
        nextMin != null &&
        nextMax != null &&
        nextMin > nextMax
      ) {
        return res.status(400).json({
          success: false,
          message: "Minimum salary cannot exceed maximum salary."
        });
      }

      if (
        data.isActive !== undefined &&
        typeof data.isActive !== "boolean"
      ) {
        return res.status(400).json({
          success: false,
          message: "isActive must be true or false."
        });
      }

      if (req.body.expiresAt !== undefined) {
        if (req.body.expiresAt === null || req.body.expiresAt === "") {
          data.expiresAt = null;
        } else {
          const parsedExpiry = new Date(req.body.expiresAt);

          if (Number.isNaN(parsedExpiry.getTime())) {
            return res.status(400).json({
              success: false,
              message: "expiresAt must be a valid date."
            });
          }

          data.expiresAt = parsedExpiry;
        }
      }

      const job = await prisma.job.update({
        where: {
          id: jobId
        },
        data,
        include: publicJobInclude()
      });

      return res.json({
        success: true,
        message: "Job updated successfully.",
        job
      });
    } catch (error) {
      return next(error);
    }
  }
);

/* =========================================
   COMPANY: DELETE OWN JOB
   DELETE /api/v1/jobs/:id
========================================= */

router.delete(
  "/:id",
  authenticateToken,
  authorizeRoles("COMPANY"),
  async (req, res, next) => {
    try {
      const prisma = req.app.locals.prisma;
      const jobId = req.params.id;

      const existingJob = await prisma.job.findFirst({
        where: {
          id: jobId,
          companyId: req.auth.userId
        },
        select: {
          id: true
        }
      });

      if (!existingJob) {
        return res.status(404).json({
          success: false,
          message: "Job not found or you do not have permission to delete it."
        });
      }

      await prisma.job.delete({
        where: {
          id: jobId
        }
      });

      return res.json({
        success: true,
        message: "Job deleted successfully."
      });
    } catch (error) {
      return next(error);
    }
  }
);

module.exports = router;
