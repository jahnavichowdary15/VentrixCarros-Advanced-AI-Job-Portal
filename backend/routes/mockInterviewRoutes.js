
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

// Safely parse JSON returned by AI
function parseAIJson(content) {
  if (!content) {
    throw new Error("AI returned an empty response.");
  }

  let cleaned = content.trim();

  cleaned = cleaned
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/, "");

  return JSON.parse(cleaned);
}

// Common AI request helper
async function askAI(systemPrompt, userPrompt) {
  const completion = await groq.chat.completions.create({
    model: GROQ_MODEL,
    messages: [
      {
        role: "system",
        content: systemPrompt,
      },
      {
        role: "user",
        content: userPrompt,
      },
    ],
    temperature: 0.5,
    max_tokens: 2500,
  });

  return completion.choices?.[0]?.message?.content?.trim();
}

// POST /api/v1/mock-interviews/start
// Generate five interview questions
router.post("/start", async (req, res) => {
  try {
    const {
      role,
      interviewType,
      jobDescription = "",
    } = req.body;

    if (!role?.trim()) {
      return res.status(400).json({
        success: false,
        message: "Please select a target role.",
      });
    }

    const allowedTypes = [
      "Technical",
      "Behavioral",
      "Mixed",
      "Company",
    ];

    const selectedType = allowedTypes.includes(interviewType)
      ? interviewType
      : "Technical";

    const prompt = `
Create exactly five realistic mock interview questions.

Target role: ${role}
Interview type: ${selectedType}
Job description: ${jobDescription || "Not provided"}

Requirements:
- Questions must be relevant to the target role.
- Match the selected interview type.
- Avoid duplicate questions.
- Make questions appropriate for a student or job applicant.
- If a job description is provided, use its requirements to personalize questions.

Return ONLY valid JSON in this exact structure:

{
  "questions": [
    "Question 1",
    "Question 2",
    "Question 3",
    "Question 4",
    "Question 5"
  ]
}
`;

    const content = await askAI(
      "You are an experienced professional interviewer. Generate relevant and realistic interview questions. Return valid JSON only.",
      prompt
    );

    const result = parseAIJson(content);

    if (
      !Array.isArray(result.questions) ||
      result.questions.length !== 5 ||
      result.questions.some(
        (question) =>
          typeof question !== "string" || !question.trim()
      )
    ) {
      throw new Error("AI returned invalid interview questions.");
    }

    return res.status(200).json({
      success: true,
      message: "Interview questions generated successfully.",
      role,
      interviewType: selectedType,
      questions: result.questions,
    });
  } catch (error) {
    console.error("Mock interview start error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to generate interview questions. Please try again.",
    });
  }
});

// POST /api/v1/mock-interviews/evaluate
// Evaluate an individual interview answer
router.post("/evaluate", async (req, res) => {
  try {
    const {
      role,
      interviewType,
      question,
      answer,
    } = req.body;

    if (
      !role?.trim() ||
      !question?.trim() ||
      !answer?.trim()
    ) {
      return res.status(400).json({
        success: false,
        message: "Role, question, and answer are required.",
      });
    }

    if (answer.length > 10000) {
      return res.status(400).json({
        success: false,
        message: "Your answer is too long. Please shorten it.",
      });
    }

    const prompt = `
Evaluate this candidate's interview answer.

Target role: ${role}
Interview type: ${interviewType || "Technical"}
Interview question: ${question}
Candidate answer: ${answer}

Evaluate:
1. Relevance to the question.
2. Accuracy and understanding.
3. Clarity and communication.
4. Structure and examples.
5. Practical knowledge.

Give constructive feedback. Do not award a high score simply because the answer is long.

Return ONLY valid JSON in this exact structure:

{
  "score": 75,
  "feedback": "Detailed feedback about the answer.",
  "strengths": [
    "First strength",
    "Second strength"
  ],
  "improvements": [
    "First improvement",
    "Second improvement"
  ],
  "sampleAnswer": "A stronger example answer."
}

Score must be an integer from 0 to 100.
`;

    const content = await askAI(
      "You are a fair, experienced interview evaluator. Assess answers accurately and provide constructive feedback. Return valid JSON only.",
      prompt
    );

    const result = parseAIJson(content);

    if (
      !Number.isFinite(result.score) ||
      result.score < 0 ||
      result.score > 100 ||
      typeof result.feedback !== "string" ||
      typeof result.sampleAnswer !== "string" ||
      !Array.isArray(result.strengths) ||
      !Array.isArray(result.improvements)
    ) {
      throw new Error("AI returned an invalid answer evaluation.");
    }

    return res.status(200).json({
      success: true,
      message: "Answer evaluated successfully.",
      evaluation: {
        score: Math.round(result.score),
        feedback: result.feedback,
        strengths: result.strengths,
        improvements: result.improvements,
        sampleAnswer: result.sampleAnswer,
      },
    });
  } catch (error) {
    console.error("Mock interview evaluation error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to evaluate your answer. Please try again.",
    });
  }
});

// POST /api/v1/mock-interviews/final-report
// Generate an overall interview performance report
router.post("/final-report", async (req, res) => {
  try {
    const {
      role,
      interviewType,
      answers,
    } = req.body;

    if (
      !role?.trim() ||
      !Array.isArray(answers) ||
      answers.length === 0 ||
      answers.length > 5
    ) {
      return res.status(400).json({
        success: false,
        message: "Please provide the role and interview answers.",
      });
    }

    const validAnswers = answers.every(
      (item) =>
        typeof item.question === "string" &&
        typeof item.answer === "string" &&
        Number.isFinite(item.score)
    );

    if (!validAnswers) {
      return res.status(400).json({
        success: false,
        message: "The interview answer data is invalid.",
      });
    }

    const prompt = `
Prepare a final mock interview performance report.

Target role: ${role}
Interview type: ${interviewType || "Technical"}

Candidate's answers and individual AI scores:
${JSON.stringify(answers, null, 2)}

Evaluate the overall performance, considering answer quality,
technical or role knowledge, communication, and consistency.

Return ONLY valid JSON in this exact structure:

{
  "overallScore": 78,
  "performance": "Good",
  "summary": "Overall interview performance summary.",
  "strengths": [
    "First strength",
    "Second strength"
  ],
  "improvements": [
    "First area to improve",
    "Second area to improve"
  ],
  "recommendations": [
    "First recommendation",
    "Second recommendation"
  ]
}

overallScore must be an integer from 0 to 100.
performance must be one of:
"Excellent", "Good", "Average", "Needs Improvement".
`;

    const content = await askAI(
      "You are a senior interview coach. Prepare a fair and useful final interview performance report. Return valid JSON only.",
      prompt
    );

    const result = parseAIJson(content);

    if (
      !Number.isFinite(result.overallScore) ||
      result.overallScore < 0 ||
      result.overallScore > 100 ||
      typeof result.summary !== "string" ||
      typeof result.performance !== "string" ||
      !Array.isArray(result.strengths) ||
      !Array.isArray(result.improvements) ||
      !Array.isArray(result.recommendations)
    ) {
      throw new Error("AI returned an invalid final report.");
    }

    return res.status(200).json({
      success: true,
      message: "Final interview report generated successfully.",
      report: {
        overallScore: Math.round(result.overallScore),
        performance: result.performance,
        summary: result.summary,
        strengths: result.strengths,
        improvements: result.improvements,
        recommendations: result.recommendations,
      },
    });
  } catch (error) {
    console.error("Mock interview final report error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to generate the final report. Please try again.",
    });
  }
});

module.exports = router;
