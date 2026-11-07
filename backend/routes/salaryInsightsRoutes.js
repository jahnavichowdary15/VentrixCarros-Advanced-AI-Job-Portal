
const express = require("express");
const OpenAI = require("openai");
const { authenticateToken } = require("../middleware/authMiddleware");

const router = express.Router();

const groq = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: "https://api.groq.com/openai/v1",
});

const GROQ_MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-20b";

// Protect all Salary Insights endpoints.
router.use(authenticateToken);

function parseAIJson(content) {
  if (!content || typeof content !== "string") {
    throw new Error("AI returned an empty response.");
  }

  const cleaned = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");

  return JSON.parse(cleaned);
}

// POST /api/v1/salary-insights/generate
router.post("/generate", async (req, res) => {
  try {
    const { jobRole, location, experience, skills } = req.body;

    if (
      typeof jobRole !== "string" ||
      !jobRole.trim() ||
      typeof location !== "string" ||
      !location.trim() ||
      typeof experience !== "string" ||
      !experience.trim()
    ) {
      return res.status(400).json({
        success: false,
        message: "Job role, location, and experience are required.",
      });
    }

    const allowedExperience = [
      "Entry level",
      "1–2 years",
      "3–5 years",
      "5+ years",
    ];

    if (!allowedExperience.includes(experience)) {
      return res.status(400).json({
        success: false,
        message: "Please select a valid experience level.",
      });
    }

    if (
      skills !== undefined &&
      typeof skills !== "string"
    ) {
      return res.status(400).json({
        success: false,
        message: "Skills must be provided as text.",
      });
    }

    const cleanSkills = (skills || "")
      .split(",")
      .map((skill) => skill.trim())
      .filter(Boolean)
      .slice(0, 20);

    const input = {
      jobRole: jobRole.trim().slice(0, 150),
      location: location.trim().slice(0, 100),
      experience,
      skills: cleanSkills,
    };

    const prompt = `
You are an experienced Indian technology and recruitment compensation analyst.

Create a personalized, indicative annual salary report for this candidate.

CANDIDATE DETAILS:
Job role: ${input.jobRole}
Location: ${input.location}
Experience: ${input.experience}
Skills: ${cleanSkills.join(", ") || "Not provided"}

IMPORTANT:
1. Give a reasonable broad estimated annual salary range in Indian LPA.
2. Do not claim to have accessed live salary databases or current job listings.
3. Do not invent specific company salary offers or market statistics.
4. Treat the estimate as indicative, not guaranteed.
5. Consider the candidate's experience, role, location and skills.
6. Give practical career advice.
7. Recommend skills relevant to the target role.
8. Return valid JSON only. Do not use Markdown or code fences.

Return exactly this JSON structure:
{
  "salaryRange": {
    "minimum": 4,
    "maximum": 8
  },
  "marketPerspective": "A concise explanation of the estimate.",
  "nextSteps": [
    "Practical next step 1",
    "Practical next step 2",
    "Practical next step 3"
  ],
  "skillsToStrengthen": [
    {
      "name": "Relevant skill",
      "importance": 85
    }
  ],
  "relatedRoles": [
    {
      "name": "Related role",
      "minimum": 4,
      "maximum": 9,
      "description": "Short description"
    }
  ]
}

Use salary amounts as numeric LPA values, not strings.
Provide 3 to 5 skills and 3 related roles.
Keep all salary values positive and ensure maximum is greater than minimum.
`;

    const completion = await groq.chat.completions.create({
      model: GROQ_MODEL,
      messages: [
        {
          role: "system",
          content:
            "You are a careful Indian salary analyst. Return valid JSON only.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.4,
      max_tokens: 1800,
    });

    const content =
      completion.choices?.[0]?.message?.content?.trim();

    const report = parseAIJson(content);

    const minimum = Number(report.salaryRange?.minimum);
    const maximum = Number(report.salaryRange?.maximum);

    if (
      !Number.isFinite(minimum) ||
      !Number.isFinite(maximum) ||
      minimum <= 0 ||
      maximum <= minimum ||
      !Array.isArray(report.nextSteps) ||
      !Array.isArray(report.skillsToStrengthen) ||
      !Array.isArray(report.relatedRoles) ||
      typeof report.marketPerspective !== "string"
    ) {
      throw new Error("AI returned an invalid salary report.");
    }

    report.salaryRange = {
      minimum,
      maximum,
    };

    return res.status(200).json({
      success: true,
      message: "Salary insights generated successfully.",
      input,
      report,
    });
  } catch (error) {
    console.error("Salary insights generation error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to generate salary insights. Please try again later.",
    });
  }
});

// POST /api/v1/salary-insights/save
router.post("/save", async (req, res) => {
  try {
    const { input, report } = req.body;

    if (
      !input ||
      typeof input !== "object" ||
      !report ||
      typeof report !== "object" ||
      !report.salaryRange
    ) {
      return res.status(400).json({
        success: false,
        message: "A valid salary report is required.",
      });
    }

    const minimum = Number(report.salaryRange.minimum);
    const maximum = Number(report.salaryRange.maximum);

    if (
      !Number.isFinite(minimum) ||
      !Number.isFinite(maximum) ||
      minimum <= 0 ||
      maximum <= minimum
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid salary range.",
      });
    }

    const saved = await req.app.locals.prisma.salaryInsight.create({
      data: {
        userId: req.auth.userId,
        input,
        report,
      },
    });

    return res.status(201).json({
      success: true,
      message: "Salary report saved successfully.",
      salaryInsight: saved,
    });
  } catch (error) {
    console.error("Save salary insights error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to save the salary report.",
    });
  }
});

// GET /api/v1/salary-insights/history
router.get("/history", async (req, res) => {
  try {
    const history = await req.app.locals.prisma.salaryInsight.findMany({
      where: {
        userId: req.auth.userId,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return res.json({
      success: true,
      count: history.length,
      salaryInsights: history,
    });
  } catch (error) {
    console.error("Salary insights history error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to retrieve salary reports.",
    });
  }
});

// GET /api/v1/salary-insights/:id
router.get("/:id", async (req, res) => {
  try {
    const salaryInsight =
      await req.app.locals.prisma.salaryInsight.findFirst({
        where: {
          id: req.params.id,
          userId: req.auth.userId,
        },
      });

    if (!salaryInsight) {
      return res.status(404).json({
        success: false,
        message: "Salary report not found.",
      });
    }

    return res.json({
      success: true,
      salaryInsight,
    });
  } catch (error) {
    console.error("Get salary insight error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to retrieve the salary report.",
    });
  }
});

module.exports = router;
