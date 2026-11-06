const express = require("express");
const OpenAI = require("openai");
const multer = require("multer");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");

const { authenticateToken } = require("../middleware/authMiddleware");

const router = express.Router();

// All resume endpoints require authentication.
router.use(authenticateToken);

// Groq AI configuration.
const groq = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: "https://api.groq.com/openai/v1"
});

const GROQ_MODEL =
  process.env.GROQ_MODEL || "openai/gpt-oss-20b";

const MAX_RESUME_TEXT = 30000;
const MAX_UPLOAD_SIZE = 5 * 1024 * 1024;

const allowedTemplates = [
  "professional",
  "modern",
  "minimal",
  "fresher"
];

// Multer configuration.
const upload = multer({
  storage: multer.memoryStorage(),

  limits: {
    fileSize: MAX_UPLOAD_SIZE,
    files: 1
  },

  fileFilter(req, file, callback) {
    const name = (file.originalname || "").toLowerCase();

    const validPdf = name.endsWith(".pdf");

    const validDocx = name.endsWith(".docx");

    if (!validPdf && !validDocx) {
      return callback(
        new Error("Only PDF and DOCX resume files are supported.")
      );
    }

    callback(null, true);
  }
});

// Helper functions.

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function getPrisma(req) {
  return req.app.locals.prisma;
}

function requireGroq(res) {
  if (process.env.GROQ_API_KEY) {
    return false;
  }

  res.status(503).json({
    success: false,
    message: "AI resume services are not configured."
  });

  return true;
}

function handleAiError(error, res, action) {
  console.error(`${action} failed:`, error.message);

  if (error.status === 401) {
    return res.status(502).json({
      success: false,
      message: "The AI provider rejected the configured API key."
    });
  }

  if (error.status === 429) {
    return res.status(503).json({
      success: false,
      message: "AI service is busy or its usage limit has been reached. Please try again later."
    });
  }

  return res.status(500).json({
    success: false,
    message: `Unable to ${action.toLowerCase()} right now.`
  });
}

// Handle uploaded resume files.
function uploadSingleResume(req, res, next) {
  upload.single("resumeFile")(req, res, (error) => {
    if (!error) {
      return next();
    }

    const status =
      error instanceof multer.MulterError
        ? error.code === "LIMIT_FILE_SIZE"
          ? 413
          : 400
        : 400;

    return res.status(status).json({
      success: false,
      message: error.message || "Unable to process uploaded file."
    });
  });
}

// Extract text from PDF, DOCX or pasted resume text.
async function extractResumeText(req) {
  if (!req.file) {
    return typeof req.body.resumeText === "string"
      ? req.body.resumeText.trim()
      : "";
  }

  const fileName =
    (req.file.originalname || "").toLowerCase();

  if (fileName.endsWith(".pdf")) {
    if (
      req.file.buffer.subarray(0, 5).toString() !== "%PDF-"
    ) {
      throw new Error("The uploaded file is not a valid PDF.");
    }

    const result = await pdfParse(req.file.buffer);

    return (result.text || "").trim();
  }

  if (fileName.endsWith(".docx")) {
    if (
      req.file.buffer.subarray(0, 2).toString() !== "PK"
    ) {
      throw new Error("The uploaded file is not a valid DOCX document.");
    }

    const result = await mammoth.extractRawText({
      buffer: req.file.buffer
    });

    return (result.value || "").trim();
  }

  throw new Error("Only PDF and DOCX files are supported.");
}

// Validate extracted resume text.
function validateResumeText(text) {
  if (!text) {
    return "Please upload a PDF/DOCX resume or paste your resume text.";
  }

  if (text.length > MAX_RESUME_TEXT) {
    return "Resume text is too long. Maximum allowed length is 30,000 characters.";
  }

  if (text.length < 80) {
    return "Not enough resume text could be extracted. Please check your file or paste your resume text.";
  }

  return null;
}

// Standard AI-generated resume structure.
function resumeJsonInstructions() {
  return `
Return ONLY valid JSON with this structure:

{
  "personalInfo": {
    "fullName": "",
    "email": "",
    "phone": "",
    "location": "",
    "linkedin": "",
    "portfolio": "",
    "github": ""
  },
  "targetRole": "",
  "professionalSummary": "",
  "skills": [],
  "education": [
    {
      "qualification": "",
      "institution": "",
      "location": "",
      "startDate": "",
      "endDate": "",
      "grade": ""
    }
  ],
  "experience": [
    {
      "jobTitle": "",
      "company": "",
      "location": "",
      "startDate": "",
      "endDate": "",
      "description": []
    }
  ],
  "projects": [
    {
      "name": "",
      "technologies": [],
      "description": [],
      "link": ""
    }
  ],
  "certifications": [],
  "achievements": []
}

Use empty arrays when information is unavailable.
Use empty strings for unavailable scalar values.
Do not return Markdown fences or explanatory text.
`;
}

function validResumeContent(content) {
  return (
    isPlainObject(content) &&
    isPlainObject(content.personalInfo) &&
    typeof content.professionalSummary === "string" &&
    Array.isArray(content.skills) &&
    Array.isArray(content.education) &&
    Array.isArray(content.experience) &&
    Array.isArray(content.projects) &&
    Array.isArray(content.certifications) &&
    Array.isArray(content.achievements)
  );
}

// ======================================================
// 1. GENERATE RESUME
// POST /api/v1/resumes/generate
// Existing structured resume builder.
// ======================================================

router.post("/generate", async (req, res) => {
  try {
    if (requireGroq(res)) return;

    const {
      title,
      targetRole,
      targetIndustry,
      template,
      resumeData
    } = req.body;

    if (
      typeof targetRole !== "string" ||
      !targetRole.trim()
    ) {
      return res.status(400).json({
        success: false,
        message: "Please provide a target job role."
      });
    }

    if (!isPlainObject(resumeData)) {
      return res.status(400).json({
        success: false,
        message: "Please provide your resume information."
      });
    }

    if (
      JSON.stringify(resumeData).length >
      MAX_RESUME_TEXT
    ) {
      return res.status(400).json({
        success: false,
        message: "Resume information is too long."
      });
    }

    const selectedTemplate =
      allowedTemplates.includes(template)
        ? template
        : "professional";

    const selectedTitle =
      typeof title === "string" && title.trim()
        ? title.trim().slice(0, 120)
        : "My Resume";

    const selectedIndustry =
      typeof targetIndustry === "string"
        ? targetIndustry.trim().slice(0, 120)
        : "";

    const completion =
      await groq.chat.completions.create({
        model: GROQ_MODEL,
        temperature: 0.3,

        response_format: {
          type: "json_object"
        },

        messages: [
          {
            role: "system",
            content: `
You are a professional ATS-friendly resume writer.

Use ONLY information supplied by the student.

STRICT RULES:
1. Never invent degrees, institutions, employers, job titles, dates, skills, certifications, achievements, metrics or experience.
2. Never turn an unfinished project into a completed project.
3. Never claim a skill that is not supported by the supplied information.
4. Improve grammar, clarity, structure and professional wording.
5. Use empty fields when information is unavailable.
6. Write a professional summary based only on actual information.
7. Use an honest fresher-level summary for students without employment experience.

${resumeJsonInstructions()}
`
          },

          {
            role: "user",
            content: JSON.stringify({
              targetRole: targetRole.trim(),
              targetIndustry: selectedIndustry,
              resumeInformation: resumeData
            })
          }
        ]
      });

    const aiContent =
      completion.choices?.[0]?.message?.content;

    if (!aiContent) {
      throw new Error("The AI returned an empty response.");
    }

    let resumeContent;

    try {
      resumeContent = JSON.parse(aiContent);
    } catch {
      return res.status(502).json({
        success: false,
        message: "AI returned an invalid resume format."
      });
    }

    if (!validResumeContent(resumeContent)) {
      return res.status(502).json({
        success: false,
        message: "AI returned an incomplete resume."
      });
    }

    const savedResume =
      await getPrisma(req).resume.create({
        data: {
          userId: req.auth.userId,
          title: selectedTitle,
          targetRole: targetRole.trim().slice(0, 120),
          targetIndustry: selectedIndustry || null,
          template: selectedTemplate,
          content: resumeContent
        }
      });

    return res.status(201).json({
      success: true,
      message: "Your AI resume was generated and saved successfully.",
      resume: savedResume
    });

  } catch (error) {
    return handleAiError(
      error,
      res,
      "Generate resume"
    );
  }
});

// ======================================================
// 2. AI RESUME ANALYZER
// POST /api/v1/resumes/analyze
// Supports PDF, DOCX and pasted resume text.
// ======================================================

router.post(
  "/analyze",
  uploadSingleResume,
  async (req, res) => {
    try {
      if (requireGroq(res)) return;

      const targetRole =
        typeof req.body.targetRole === "string"
          ? req.body.targetRole.trim()
          : "";

      const jobDescription =
        typeof req.body.jobDescription === "string"
          ? req.body.jobDescription.trim()
          : "";

      if (
        !targetRole ||
        targetRole.length > 120
      ) {
        return res.status(400).json({
          success: false,
          message: "Please provide a valid target job role."
        });
      }

      if (jobDescription.length > 12000) {
        return res.status(400).json({
          success: false,
          message: "The job description is too long."
        });
      }

      let resumeText;

      try {
        resumeText = await extractResumeText(req);
      } catch (error) {
        return res.status(400).json({
          success: false,
          message: error.message
        });
      }

      const validationError =
        validateResumeText(resumeText);

      if (validationError) {
        return res.status(400).json({
          success: false,
          message: validationError
        });
      }

      const completion =
        await groq.chat.completions.create({
          model: GROQ_MODEL,
          temperature: 0.2,

          response_format: {
            type: "json_object"
          },

          messages: [
            {
              role: "system",
              content: `
You are an experienced recruiter and ATS resume analyst.

Compare the supplied resume with the target role and optional job description.

Be fair and evidence-based.
Do not assume skills or experience that are not stated.
Do not penalize a fresher merely for lacking professional employment.
Assess relevant education, projects, internships and demonstrable skills.

The match score is an estimate, not a guarantee of ATS performance or hiring.

Return ONLY valid JSON:

{
  "matchScore": 0,
  "scoreLabel": "",
  "summary": "",
  "strengths": [
    {
      "title": "",
      "detail": ""
    }
  ],
  "weaknesses": [
    {
      "title": "",
      "detail": ""
    }
  ],
  "matchedSkills": [],
  "missingSkills": [],
  "matchedKeywords": [],
  "missingKeywords": [],
  "recommendations": [
    {
      "priority": "High",
      "title": "",
      "detail": ""
    }
  ],
  "roleFit": "",
  "experienceFit": ""
}

RULES:
- matchScore must be an integer from 0 to 100.
- scoreLabel should describe the score.
- Strengths and weaknesses must refer to evidence or gaps.
- Missing skills must be relevant to the target role.
- Distinguish a missing skill from a skill that is simply not mentioned.
- Never tell the student to claim a skill they do not have.
- Recommend learning missing skills where appropriate.
- Keep recommendations specific and actionable.
- Use empty arrays when no items apply.
- No Markdown fences or text outside JSON.
`
            },

            {
              role: "user",
              content: JSON.stringify({
                targetRole,
                jobDescription,
                resumeText
              })
            }
          ]
        });

      const aiContent =
        completion.choices?.[0]?.message?.content;

      if (!aiContent) {
        throw new Error("The AI returned an empty analysis.");
      }

      let analysis;

      try {
        analysis = JSON.parse(aiContent);
      } catch {
        return res.status(502).json({
          success: false,
          message: "AI returned an invalid analysis format."
        });
      }

      const score = Number(analysis.matchScore);

      if (
        !isPlainObject(analysis) ||
        !Number.isFinite(score) ||
        score < 0 ||
        score > 100 ||
        !Array.isArray(analysis.strengths) ||
        !Array.isArray(analysis.weaknesses) ||
        !Array.isArray(analysis.recommendations)
      ) {
        return res.status(502).json({
          success: false,
          message: "AI returned an incomplete analysis."
        });
      }

      return res.json({
        success: true,
        message: "Resume analysis completed.",

        targetRole,

        analysis: {
          ...analysis,
          matchScore: Math.round(score)
        },

        source: {
          fileName: req.file?.originalname || null,
          extractedCharacters: resumeText.length
        },

        resumeText
      });

    } catch (error) {
      return handleAiError(
        error,
        res,
        "Analyze resume"
      );
    }
  }
);

// ======================================================
// 3. AI RESUME IMPROVEMENT
// POST /api/v1/resumes/improve
// Generates and saves an improved resume.
// ======================================================

router.post(
  "/improve",
  uploadSingleResume,
  async (req, res) => {
    try {
      if (requireGroq(res)) return;

      const targetRole =
        typeof req.body.targetRole === "string"
          ? req.body.targetRole.trim()
          : "";

      const jobDescription =
        typeof req.body.jobDescription === "string"
          ? req.body.jobDescription.trim()
          : "";

      const targetIndustry =
        typeof req.body.targetIndustry === "string"
          ? req.body.targetIndustry.trim().slice(0, 120)
          : "";

      const title =
        typeof req.body.title === "string" &&
        req.body.title.trim()
          ? req.body.title.trim().slice(0, 120)
          : "AI Improved Resume";

      const template =
        allowedTemplates.includes(req.body.template)
          ? req.body.template
          : "professional";

      if (
        !targetRole ||
        targetRole.length > 120
      ) {
        return res.status(400).json({
          success: false,
          message: "Please provide a valid target job role."
        });
      }

      if (jobDescription.length > 12000) {
        return res.status(400).json({
          success: false,
          message: "The job description is too long."
        });
      }

      let resumeText;

      try {
        resumeText = await extractResumeText(req);
      } catch (error) {
        return res.status(400).json({
          success: false,
          message: error.message
        });
      }

      const validationError =
        validateResumeText(resumeText);

      if (validationError) {
        return res.status(400).json({
          success: false,
          message: validationError
        });
      }

      const completion =
        await groq.chat.completions.create({
          model: GROQ_MODEL,
          temperature: 0.25,

          response_format: {
            type: "json_object"
          },

          messages: [
            {
              role: "system",
              content: `
You are a careful professional resume writer.

Rewrite the student's resume for the target role and optional job description.

NON-NEGOTIABLE RULES:

1. Use ONLY facts in the original resume.
2. Never invent skills, degrees, institutions, employers, job titles, dates, certifications, achievements, metrics, links or responsibilities.
3. Do not turn coursework, personal projects or academic work into employment.
4. Include a skill only when the original resume supports it.
5. Improve grammar, clarity, ATS-friendly wording and section order only.
6. Preserve the original meaning and level of responsibility.
7. Do not add fabricated numbers or measurable outcomes.
8. Use empty values when information is unavailable.
9. Keep the resume suitable for a student or fresher when appropriate.
10. The job description is a targeting reference, NOT a source of student facts.

${resumeJsonInstructions()}
`
            },

            {
              role: "user",
              content: JSON.stringify({
                targetRole,
                targetIndustry,
                jobDescription,
                originalResumeText: resumeText
              })
            }
          ]
        });

      const aiContent =
        completion.choices?.[0]?.message?.content;

      if (!aiContent) {
        throw new Error("The AI returned an empty improved resume.");
      }

      let resumeContent;

      try {
        resumeContent = JSON.parse(aiContent);
      } catch {
        return res.status(502).json({
          success: false,
          message: "AI returned an invalid resume format."
        });
      }

      if (!validResumeContent(resumeContent)) {
        return res.status(502).json({
          success: false,
          message: "AI returned an incomplete resume."
        });
      }

      const savedResume =
        await getPrisma(req).resume.create({
          data: {
            userId: req.auth.userId,
            title,
            targetRole,
            targetIndustry: targetIndustry || null,
            template,
            content: resumeContent
          }
        });

      return res.status(201).json({
        success: true,
        message: "Your improved resume was generated and saved successfully.",
        resume: savedResume
      });

    } catch (error) {
      return handleAiError(
        error,
        res,
        "Improve resume"
      );
    }
  }
);

// ======================================================
// 4. GET ALL SAVED RESUMES
// GET /api/v1/resumes/me
// ======================================================

router.get("/me", async (req, res) => {
  try {
    const resumes =
      await getPrisma(req).resume.findMany({
        where: {
          userId: req.auth.userId
        },

        orderBy: {
          updatedAt: "desc"
        }
      });

    return res.json({
      success: true,
      count: resumes.length,
      resumes
    });

  } catch (error) {
    console.error("Fetch resumes failed:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to retrieve your resumes."
    });
  }
});

// ======================================================
// 5. GET ONE RESUME
// GET /api/v1/resumes/:id
// ======================================================

router.get("/:id", async (req, res) => {
  try {
    const resume =
      await getPrisma(req).resume.findFirst({
        where: {
          id: req.params.id,
          userId: req.auth.userId
        }
      });

    if (!resume) {
      return res.status(404).json({
        success: false,
        message: "Resume not found."
      });
    }

    return res.json({
      success: true,
      resume
    });

  } catch (error) {
    console.error("Fetch resume failed:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to retrieve this resume."
    });
  }
});

// ======================================================
// 6. UPDATE SAVED RESUME
// PUT /api/v1/resumes/:id
// ======================================================

router.put("/:id", async (req, res) => {
  try {
    const {
      title,
      content,
      template
    } = req.body;

    if (!isPlainObject(content)) {
      return res.status(400).json({
        success: false,
        message: "Valid resume content is required."
      });
    }

    if (
      JSON.stringify(content).length >
      MAX_RESUME_TEXT
    ) {
      return res.status(400).json({
        success: false,
        message: "Resume content is too large."
      });
    }

    const prisma = getPrisma(req);

    const existing =
      await prisma.resume.findFirst({
        where: {
          id: req.params.id,
          userId: req.auth.userId
        }
      });

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "Resume not found."
      });
    }

    const updatedResume =
      await prisma.resume.update({
        where: {
          id: existing.id
        },

        data: {
          content,

          ...(typeof title === "string" && title.trim()
            ? {
                title: title.trim().slice(0, 120)
              }
            : {}),

          ...(allowedTemplates.includes(template)
            ? { template }
            : {})
        }
      });

    return res.json({
      success: true,
      message: "Resume updated successfully.",
      resume: updatedResume
    });

  } catch (error) {
    console.error("Update resume failed:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to update your resume."
    });
  }
});

// ======================================================
// 7. DELETE SAVED RESUME
// DELETE /api/v1/resumes/:id
// ======================================================

router.delete("/:id", async (req, res) => {
  try {
    const prisma = getPrisma(req);

    const existing =
      await prisma.resume.findFirst({
        where: {
          id: req.params.id,
          userId: req.auth.userId
        }
      });

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "Resume not found."
      });
    }

    await prisma.resume.delete({
      where: {
        id: existing.id
      }
    });

    return res.json({
      success: true,
      message: "Resume deleted successfully."
    });

  } catch (error) {
    console.error("Delete resume failed:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to delete this resume."
    });
  }
});

// Export routes.
module.exports = router;