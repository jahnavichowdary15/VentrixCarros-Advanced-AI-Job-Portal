
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

// POST /api/v1/career-roadmaps/generate
router.post("/generate", async (req, res) => {
  try {
    const {
      currentRole,
      targetRole,
      timeline,
      skills,
      careerGoal,
    } = req.body;

    if (
      !currentRole?.trim() ||
      !targetRole?.trim() ||
      !timeline?.trim()
    ) {
      return res.status(400).json({
        success: false,
        message: "Current role, target role, and timeline are required.",
      });
    }

    if (
      !Array.isArray(skills) ||
      skills.length > 30 ||
      skills.some(
        (skill) => typeof skill !== "string" || skill.length > 100
      )
    ) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid list of skills.",
      });
    }

    if (
      typeof careerGoal !== "string" ||
      careerGoal.length > 2000
    ) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid career goal.",
      });
    }

    const prompt = `
Create a personalized and practical career roadmap.

CURRENT ROLE: ${currentRole}
TARGET ROLE: ${targetRole}
TARGET TIMELINE: ${timeline}
CURRENT SKILLS: ${skills.length ? skills.join(", ") : "Not provided"}
CAREER GOAL: ${careerGoal || "Not provided"}

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
  "duration": "${timeline}",
  "skillGaps": [
    "Skill to develop"
  ],
  "milestones": [
    {
      "title": "Milestone title",
      "description": "What the candidate needs to learn or achieve.",
      "duration": "4 weeks",
      "tasks": [
        "Practical task one",
        "Practical task two"
      ],
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

    if (
      typeof result.title !== "string" ||
      typeof result.description !== "string" ||
      !Array.isArray(result.skillGaps) ||
      !Array.isArray(result.milestones) ||
      result.milestones.length < 5 ||
      result.milestones.length > 8 ||
      !Array.isArray(result.recommendations)
    ) {
      throw new Error("AI returned an invalid career roadmap.");
    }

    const validMilestones = result.milestones.every(
      (item) =>
        typeof item.title === "string" &&
        typeof item.description === "string" &&
        typeof item.duration === "string" &&
        Array.isArray(item.tasks) &&
        typeof item.project === "string"
    );

    if (!validMilestones) {
      throw new Error("AI returned invalid roadmap milestones.");
    }

    return res.status(200).json({
      success: true,
      message: "Career roadmap generated successfully.",
      roadmap: {
        title: result.title,
        description: result.description,
        duration: result.duration || timeline,
        skillGaps: result.skillGaps,
        milestones: result.milestones,
        recommendations: result.recommendations,
      },
    });

  } catch (error) {
    console.error("Career roadmap generation error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to generate your career roadmap. Please try again.",
    });
  }
});

module.exports = router;
