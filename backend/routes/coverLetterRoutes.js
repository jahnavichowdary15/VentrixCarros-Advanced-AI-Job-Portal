
const express = require("express");
const OpenAI = require("openai");
const { authenticateToken } = require("../middleware/authMiddleware");

const router = express.Router();

const groq = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: "https://api.groq.com/openai/v1",
});

const GROQ_MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-20b";

// Protect all cover-letter routes
router.use(authenticateToken);

// POST /api/v1/cover-letters/generate
router.post("/generate", async (req, res) => {
  try {
    const {
      candidateName,
      jobTitle,
      companyName,
      experience,
      skills,
      jobDescription,
      tone,
    } = req.body;

    // Validate required information
    if (
      !candidateName?.trim() ||
      !jobTitle?.trim() ||
      !companyName?.trim() ||
      !experience?.trim() ||
      !jobDescription?.trim()
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Please provide your name, job title, company, experience, and job description.",
      });
    }

    const allowedTones = [
      "Professional",
      "Confident",
      "Friendly",
      "Concise",
    ];

    const selectedTone = allowedTones.includes(tone)
      ? tone
      : "Professional";

    const prompt = `
You are an expert professional cover-letter writer.

Write a personalized, high-quality job application cover letter using the information below.

CANDIDATE NAME: ${candidateName}
JOB TITLE: ${jobTitle}
COMPANY NAME: ${companyName}
EXPERIENCE: ${experience}
SKILLS: ${skills || "Not provided"}
JOB DESCRIPTION:
${jobDescription}

WRITING TONE: ${selectedTone}

IMPORTANT INSTRUCTIONS:
1. Address the letter to the company and target job.
2. Connect the candidate's actual skills and experience to the job requirements.
3. Make the letter natural, convincing, and professionally written.
4. Do not invent qualifications, achievements, employment history, or skills.
5. If the candidate is a fresher, emphasize relevant skills, education,
   projects, willingness to learn, and motivation without inventing facts.
6. Avoid generic filler sentences and unnecessary repetition.
7. Use the selected writing tone consistently.
8. Include a suitable opening, body paragraphs, and professional closing.
9. Return only the complete cover letter text.
10. Do not include explanations, Markdown code fences, or labels such as
    "Generated Cover Letter".
`;

    const completion = await groq.chat.completions.create({
      model: GROQ_MODEL,
      messages: [
        {
          role: "system",
          content:
            "You write accurate, personalized, professional job application cover letters.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.7,
      max_tokens: 1500,
    });

    const coverLetter =
      completion.choices?.[0]?.message?.content?.trim();

    if (!coverLetter) {
      return res.status(502).json({
        success: false,
        message: "AI could not generate the cover letter. Please try again.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Cover letter generated successfully.",
      coverLetter,
    });
  } catch (error) {
    console.error("Cover letter generation error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to generate the cover letter. Please try again later.",
    });
  }
});

module.exports = router;
