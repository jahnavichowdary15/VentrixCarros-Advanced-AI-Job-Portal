
const express = require("express");
const OpenAI = require("openai");
const { authenticateToken } = require("../middleware/authMiddleware");

const router = express.Router();

const groq = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: "https://api.groq.com/openai/v1",
});

const GROQ_MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-20b";

router.use(authenticateToken);

// =========================================
// HELPERS
// =========================================

function getPrisma(req) {
  return req.app.locals.prisma;
}

function getUserId(req) {
  return req.auth?.userId;
}

function parseAIJson(content) {
  if (!content) {
    throw new Error("AI returned an empty response.");
  }

  const cleaned = content
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/, "");

  return JSON.parse(cleaned);
}

function isValidRoadmap(roadmap) {
  if (
    !roadmap ||
    typeof roadmap.title !== "string" ||
    typeof roadmap.description !== "string" ||
    !Array.isArray(roadmap.skillGaps) ||
    !Array.isArray(roadmap.milestones) ||
    roadmap.milestones.length < 5 ||
    roadmap.milestones.length > 8 ||
    !Array.isArray(roadmap.recommendations)
  ) {
    return false;
  }

  return roadmap.milestones.every(
    (item) =>
      item &&
      typeof item.title === "string" &&
      typeof item.description === "string" &&
      typeof item.duration === "string" &&
      Array.isArray(item.tasks) &&
      typeof item.project === "string"
  );
}

function getInitialProgress(total) {
  return {
    completedMilestones: [],
    completedCount: 0,
    totalMilestones: total,
    percentage: 0,
  };
}

// =========================================
// GENERATE AND SAVE ROADMAP
// POST /api/v1/career-roadmaps/generate
// =========================================

router.post("/generate", async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const userId = getUserId(req);

    if (!prisma || !userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication or database connection is unavailable.",
      });
    }

    const {
      currentRole,
      targetRole,
      timeline,
      skills,
      careerGoal,
    } = req.body;

    if (
      typeof currentRole !== "string" ||
      !currentRole.trim() ||
      currentRole.length > 120 ||
      typeof targetRole !== "string" ||
      !targetRole.trim() ||
      targetRole.length > 120 ||
      typeof timeline !== "string" ||
      !timeline.trim() ||
      timeline.length > 50
    ) {
      return res.status(400).json({
        success: false,
        message: "Please provide valid current role, target role and timeline.",
      });
    }

    if (
      !Array.isArray(skills) ||
      skills.length > 30 ||
      skills.some(
        (skill) =>
          typeof skill !== "string" ||
          !skill.trim() ||
          skill.length > 100
      )
    ) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid list of skills.",
      });
    }

    if (
      careerGoal !== undefined &&
      careerGoal !== null &&
      (typeof careerGoal !== "string" || careerGoal.length > 2000)
    ) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid career goal.",
      });
    }

    if (!process.env.GROQ_API_KEY) {
      return res.status(500).json({
        success: false,
        message: "AI service is not configured.",
      });
    }

    const cleanCurrentRole = currentRole.trim();
    const cleanTargetRole = targetRole.trim();
    const cleanTimeline = timeline.trim();
    const cleanSkills = skills.map((skill) => skill.trim());
    const cleanCareerGoal = careerGoal?.trim() || "";

    const prompt = `
Create a personalized and practical career roadmap.

CURRENT ROLE: ${cleanCurrentRole}
TARGET ROLE: ${cleanTargetRole}
TARGET TIMELINE: ${cleanTimeline}
CURRENT SKILLS: ${cleanSkills.length ? cleanSkills.join(", ") : "Not provided"}
CAREER GOAL: ${cleanCareerGoal || "Not provided"}

Requirements:
1. Identify important skills needed for the target role.
2. Identify the candidate's skill gaps.
3. Create 5 to 8 ordered learning milestones.
4. Give every milestone a clear title, description, duration, and practical tasks.
5. Include realistic project recommendations.
6. Include interview and job preparation guidance.
7. Respect the requested timeline.
8. Make the plan appropriate to the candidate's current role and skills.
9. Avoid generic or unrealistic recommendations.

Return ONLY valid JSON in this exact structure:

{
  "title": "Personalized career roadmap title",
  "description": "Summary of the candidate's career development plan.",
  "duration": "${cleanTimeline}",
  "skillGaps": ["Skill to develop"],
  "milestones": [
    {
      "title": "Milestone title",
      "description": "What the candidate needs to learn or achieve.",
      "duration": "4 weeks",
      "tasks": ["Practical task one", "Practical task two"],
      "project": "A practical project recommendation"
    }
  ],
  "recommendations": [
    "Career recommendation one",
    "Career recommendation two"
  ]
}
`;

    const completion = await groq.chat.completions.create({
      model: GROQ_MODEL,
      messages: [
        {
          role: "system",
          content:
            "You are an expert career strategist and professional career coach. Create realistic, personalized career development plans. Return valid JSON only.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.5,
      max_tokens: 4000,
    });

    const content =
      completion.choices?.[0]?.message?.content?.trim();

    const result = parseAIJson(content);

    const roadmap = {
      title: result.title,
      description: result.description,
      duration:
        typeof result.duration === "string" && result.duration.trim()
          ? result.duration
          : cleanTimeline,
      skillGaps: result.skillGaps,
      milestones: result.milestones,
      recommendations: result.recommendations,
    };

    if (!isValidRoadmap(roadmap)) {
      throw new Error("AI returned an invalid career roadmap.");
    }

    // Save generated roadmap to MySQL.
    const savedRoadmap = await prisma.careerRoadmap.create({
      data: {
        userId,
        currentRole: cleanCurrentRole,
        targetRole: cleanTargetRole,
        timeline: cleanTimeline,
        skills: cleanSkills,
        careerGoal: cleanCareerGoal || null,
        roadmap,
        progress: getInitialProgress(roadmap.milestones.length),
        status: "IN_PROGRESS",
      },
    });

    return res.status(201).json({
      success: true,
      message: "Career roadmap generated and saved successfully.",
      roadmapId: savedRoadmap.id,
      roadmap: savedRoadmap.roadmap,
      progress: savedRoadmap.progress,
      status: savedRoadmap.status,
      createdAt: savedRoadmap.createdAt,
    });
  } catch (error) {
    console.error("Career roadmap generation error:", error);

    return res.status(500).json({
      success: false,
      message:
        "Unable to generate and save your career roadmap. Please try again.",
    });
  }
});

// =========================================
// GET ROADMAP HISTORY
// GET /api/v1/career-roadmaps/history
// =========================================

router.get("/history", async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const userId = getUserId(req);

    const roadmaps = await prisma.careerRoadmap.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        currentRole: true,
        targetRole: true,
        timeline: true,
        status: true,
        progress: true,
        createdAt: true,
        updatedAt: true,
        completedAt: true,
        roadmap: true,
      },
    });

    return res.json({
      success: true,
      total: roadmaps.length,
      roadmaps,
    });
  } catch (error) {
    console.error("Career roadmap history error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to load career roadmap history.",
    });
  }
});

// =========================================
// GET ONE SAVED ROADMAP
// GET /api/v1/career-roadmaps/:id
// =========================================

router.get("/:id", async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const userId = getUserId(req);
    const { id } = req.params;

    const roadmap = await prisma.careerRoadmap.findFirst({
      where: {
        id,
        userId,
      },
    });

    if (!roadmap) {
      return res.status(404).json({
        success: false,
        message: "Career roadmap not found.",
      });
    }

    return res.json({
      success: true,
      roadmap,
    });
  } catch (error) {
    console.error("Career roadmap retrieval error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to retrieve career roadmap.",
    });
  }
});

// =========================================
// UPDATE MILESTONE PROGRESS
// PATCH /api/v1/career-roadmaps/:id/progress
// =========================================

router.patch("/:id/progress", async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const userId = getUserId(req);
    const { id } = req.params;
    const { completedMilestones } = req.body;

    if (
      !Array.isArray(completedMilestones) ||
      completedMilestones.some(
        (index) =>
          !Number.isInteger(index) ||
          index < 0
      )
    ) {
      return res.status(400).json({
        success: false,
        message: "Please provide valid completed milestone indexes.",
      });
    }

    const existing = await prisma.careerRoadmap.findFirst({
      where: {
        id,
        userId,
      },
    });

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "Career roadmap not found.",
      });
    }

    const roadmapData = existing.roadmap;
    const milestones = roadmapData?.milestones;

    if (!Array.isArray(milestones) || milestones.length === 0) {
      return res.status(400).json({
        success: false,
        message: "This roadmap has no valid milestones.",
      });
    }

    const uniqueIndexes = [...new Set(completedMilestones)];

    if (uniqueIndexes.some((index) => index >= milestones.length)) {
      return res.status(400).json({
        success: false,
        message: "A milestone index is outside this roadmap.",
      });
    }

    const totalMilestones = milestones.length;
    const completedCount = uniqueIndexes.length;
    const percentage = Math.round(
      (completedCount / totalMilestones) * 100
    );

    const isCompleted = completedCount === totalMilestones;

    const progress = {
      completedMilestones: uniqueIndexes.sort((a, b) => a - b),
      completedCount,
      totalMilestones,
      percentage,
    };

    const updated = await prisma.careerRoadmap.update({
      where: { id },
      data: {
        progress,
        status: isCompleted ? "COMPLETED" : "IN_PROGRESS",
        completedAt: isCompleted ? new Date() : null,
      },
    });

    return res.json({
      success: true,
      message: "Career roadmap progress updated.",
      progress: updated.progress,
      status: updated.status,
      completedAt: updated.completedAt,
    });
  } catch (error) {
    console.error("Career roadmap progress error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to update career roadmap progress.",
    });
  }
});

module.exports = router;
