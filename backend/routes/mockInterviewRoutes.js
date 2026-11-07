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

const ALLOWED_TYPES = [
  "Technical",
  "Behavioral",
  "Mixed",
  "Company",
];

const ALLOWED_PERFORMANCE = [
  "Excellent",
  "Good",
  "Average",
  "Needs Improvement",
];

// Shared Prisma instance
function getPrisma(req) {
  const prisma = req.app.locals.prisma;

  if (!prisma) {
    throw new Error("Database connection is unavailable.");
  }

  return prisma;
}

// Get authenticated student ID
function getUserId(req) {
  const userId = req.auth?.userId;

  if (!userId) {
    throw new Error("Authenticated user ID is unavailable.");
  }

  return userId;
}

// Safely parse JSON returned by AI
function parseAIJson(content) {
  if (!content || typeof content !== "string") {
    throw new Error("AI returned an empty response.");
  }

  let cleaned = content.trim();

  cleaned = cleaned
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/, "");

  return JSON.parse(cleaned);
}

// Validate a list of strings
function isStringArray(value) {
  return (
    Array.isArray(value) &&
    value.every(
      (item) => typeof item === "string" && item.trim().length > 0
    )
  );
}

// Common Groq AI request helper
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

  const content = completion.choices?.[0]?.message?.content?.trim();

  if (!content) {
    throw new Error("Groq returned an empty response.");
  }

  return content;
}

// Get an interview belonging to the authenticated student
async function getStudentInterview(req, interviewId) {
  if (!interviewId || typeof interviewId !== "string") {
    return null;
  }

  const prisma = getPrisma(req);
  const userId = getUserId(req);

  return prisma.mockInterview.findFirst({
    where: {
      id: interviewId,
      userId,
    },
  });
}

// ======================================================
// POST /api/v1/mock-interviews/start
// Generate five AI questions and save the interview
// ======================================================

router.post("/start", async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const userId = getUserId(req);

    const {
      role,
      interviewType,
      jobDescription = "",
    } = req.body || {};

    if (
      typeof role !== "string" ||
      !role.trim() ||
      role.length > 150
    ) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid target role.",
      });
    }

    if (
      typeof jobDescription !== "string" ||
      jobDescription.length > 20000
    ) {
      return res.status(400).json({
        success: false,
        message: "The job description is too long.",
      });
    }

    const selectedType = ALLOWED_TYPES.includes(interviewType)
      ? interviewType
      : "Technical";

    const cleanRole = role.trim();
    const cleanJobDescription = jobDescription.trim();

    const prompt = `
Create exactly five realistic mock interview questions.

Target role: ${cleanRole}
Interview type: ${selectedType}
Job description: ${cleanJobDescription || "Not provided"}

Requirements:
- Questions must be relevant to the target role.
- Match the selected interview type.
- Avoid duplicate questions.
- Make questions appropriate for a student or job applicant.
- If a job description is provided, use its requirements to personalize questions.
- Do not include answers or explanations.

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
      !isStringArray(result.questions)
    ) {
      throw new Error("AI returned invalid interview questions.");
    }

    // Save the new interview
    const interview = await prisma.mockInterview.create({
      data: {
        userId,
        role: cleanRole,
        interviewType: selectedType,
        jobDescription: cleanJobDescription || null,
        questions: result.questions,
        answers: [],
        status: "IN_PROGRESS",
      },
    });

    return res.status(201).json({
      success: true,
      message: "Interview questions generated and saved successfully.",
      interviewId: interview.id,
      role: interview.role,
      interviewType: interview.interviewType,
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

// ======================================================
// POST /api/v1/mock-interviews/evaluate
// Evaluate an answer and save its AI feedback
// ======================================================

router.post("/evaluate", async (req, res) => {
  try {
    const prisma = getPrisma(req);

    const {
      interviewId,
      questionIndex,
      role,
      interviewType,
      question,
      answer,
    } = req.body || {};

    if (
      typeof interviewId !== "string" ||
      !interviewId.trim()
    ) {
      return res.status(400).json({
        success: false,
        message: "Interview ID is required.",
      });
    }

    if (
      !Number.isInteger(questionIndex) ||
      questionIndex < 0 ||
      questionIndex > 4
    ) {
      return res.status(400).json({
        success: false,
        message: "A valid question index is required.",
      });
    }

    if (
      typeof role !== "string" ||
      !role.trim() ||
      typeof question !== "string" ||
      !question.trim() ||
      typeof answer !== "string" ||
      !answer.trim()
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

    const interview = await getStudentInterview(req, interviewId);

    if (!interview) {
      return res.status(404).json({
        success: false,
        message: "Interview not found.",
      });
    }

    if (interview.status !== "IN_PROGRESS") {
      return res.status(409).json({
        success: false,
        message: "This interview has already been completed.",
      });
    }

    const questions = interview.questions;

    if (
      !Array.isArray(questions) ||
      questions[questionIndex] !== question.trim()
    ) {
      return res.status(400).json({
        success: false,
        message: "The question does not belong to this interview.",
      });
    }

    const prompt = `
Evaluate this candidate's interview answer.

Target role: ${interview.role}
Interview type: ${interview.interviewType}
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
      !result.feedback.trim() ||
      typeof result.sampleAnswer !== "string" ||
      !result.sampleAnswer.trim() ||
      !isStringArray(result.strengths) ||
      !isStringArray(result.improvements)
    ) {
      throw new Error("AI returned an invalid answer evaluation.");
    }

    const evaluation = {
      score: Math.round(result.score),
      feedback: result.feedback,
      strengths: result.strengths,
      improvements: result.improvements,
      sampleAnswer: result.sampleAnswer,
    };

    // Preserve previous answers and update this question's answer
    const existingAnswers = Array.isArray(interview.answers)
      ? interview.answers
      : [];

    const updatedAnswers = Array.from(
      { length: questions.length },
      (_, index) => existingAnswers[index] || null
    );

    updatedAnswers[questionIndex] = {
      questionIndex,
      question: questions[questionIndex],
      answer: answer.trim(),
      score: evaluation.score,
      evaluation,
      skipped: false,
      evaluatedAt: new Date().toISOString(),
    };

    await prisma.mockInterview.update({
      where: {
        id: interview.id,
      },
      data: {
        answers: updatedAnswers,
      },
    });

    return res.status(200).json({
      success: true,
      message: "Answer evaluated and saved successfully.",
      evaluation,
    });
  } catch (error) {
    console.error("Mock interview evaluation error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to evaluate your answer. Please try again.",
    });
  }
});

// ======================================================
// POST /api/v1/mock-interviews/final-report
// Generate and save the final AI report
// ======================================================

router.post("/final-report", async (req, res) => {
  try {
    const prisma = getPrisma(req);

    const {
      interviewId,
      role,
      interviewType,
      answers,
    } = req.body || {};

    if (
      typeof interviewId !== "string" ||
      !interviewId.trim()
    ) {
      return res.status(400).json({
        success: false,
        message: "Interview ID is required.",
      });
    }

    if (
      !Array.isArray(answers) ||
      answers.length === 0 ||
      answers.length > 5
    ) {
      return res.status(400).json({
        success: false,
        message: "Please provide the interview answers.",
      });
    }

    const interview = await getStudentInterview(req, interviewId);

    if (!interview) {
      return res.status(404).json({
        success: false,
        message: "Interview not found.",
      });
    }

    if (interview.status === "COMPLETED") {
      return res.status(409).json({
        success: false,
        message: "This interview has already been completed.",
      });
    }

    const questions = interview.questions;

    const validAnswers = answers.every(
      (item) =>
        item &&
        typeof item.question === "string" &&
        typeof item.answer === "string" &&
        Number.isFinite(item.score) &&
        item.score >= 0 &&
        item.score <= 100
    );

    if (!validAnswers) {
      return res.status(400).json({
        success: false,
        message: "The interview answer data is invalid.",
      });
    }

    const normalizedAnswers = answers.map((item) => ({
      question: item.question,
      answer: item.answer,
      score: Math.round(item.score),
      skipped:
        item.answer === "Skipped by candidate.",
    }));

    const validQuestions = normalizedAnswers.every((item) =>
      questions.includes(item.question)
    );

    if (!validQuestions) {
      return res.status(400).json({
        success: false,
        message: "One or more answers do not belong to this interview.",
      });
    }

    const prompt = `
Prepare a final mock interview performance report.

Target role: ${interview.role}
Interview type: ${interview.interviewType}

Candidate's answers and individual AI scores:
${JSON.stringify(normalizedAnswers, null, 2)}

Evaluate the overall performance, considering answer quality,
technical or role knowledge, communication, and consistency.

Treat skipped questions as unanswered, not as successful answers.

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
      !result.summary.trim() ||
      !ALLOWED_PERFORMANCE.includes(result.performance) ||
      !isStringArray(result.strengths) ||
      !isStringArray(result.improvements) ||
      !isStringArray(result.recommendations)
    ) {
      throw new Error("AI returned an invalid final report.");
    }

    const report = {
      overallScore: Math.round(result.overallScore),
      performance: result.performance,
      summary: result.summary,
      strengths: result.strengths,
      improvements: result.improvements,
      recommendations: result.recommendations,
    };

    await prisma.mockInterview.update({
      where: {
        id: interview.id,
      },
      data: {
        answers: normalizedAnswers,
        report,
        overallScore: report.overallScore,
        status: "COMPLETED",
        completedAt: new Date(),
      },
    });

    return res.status(200).json({
      success: true,
      message: "Final interview report generated and saved successfully.",
      report,
    });
  } catch (error) {
    console.error("Mock interview final report error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to generate the final report. Please try again.",
    });
  }
});

// ======================================================
// GET /api/v1/mock-interviews/history
// Retrieve the authenticated student's interview history
// ======================================================

router.get("/history", async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const userId = getUserId(req);

    const interviews = await prisma.mockInterview.findMany({
      where: {
        userId,
      },
      select: {
        id: true,
        role: true,
        interviewType: true,
        overallScore: true,
        status: true,
        createdAt: true,
        completedAt: true,
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 50,
    });

    return res.status(200).json({
      success: true,
      total: interviews.length,
      interviews,
    });
  } catch (error) {
    console.error("Mock interview history error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to retrieve interview history.",
    });
  }
});

// ======================================================
// GET /api/v1/mock-interviews/:id
// Retrieve one interview and its report
// ======================================================

router.get("/:id", async (req, res) => {
  try {
    const interview = await getStudentInterview(req, req.params.id);

    if (!interview) {
      return res.status(404).json({
        success: false,
        message: "Interview not found.",
      });
    }

    return res.status(200).json({
      success: true,
      interview,
    });
  } catch (error) {
    console.error("Mock interview details error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to retrieve this interview.",
    });
  }
});

module.exports = router;