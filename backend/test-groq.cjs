require("dotenv").config();

const OpenAI = require("openai").default;

async function main() {
  if (!process.env.GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY is missing from .env");
  }

  const client = new OpenAI({
    apiKey: process.env.GROQ_API_KEY,
    baseURL: "https://api.groq.com/openai/v1"
  });

  console.log("Connecting to Groq...");
  console.log("Testing model: openai/gpt-oss-20b");

  const response = await client.chat.completions.create({
    model: "openai/gpt-oss-20b",
    messages: [
      {
        role: "system",
        content: "You are a professional AI career assistant for VentrixCarros."
      },
      {
        role: "user",
        content: "Create a short professional resume summary for a fresher who knows HTML, CSS, JavaScript and React. Do not invent experience."
      }
    ],
    temperature: 0.3
  });

  console.log("\nGROQ API TEST SUCCESSFUL");
  console.log("Model:", response.model);
  console.log("\nAI GENERATED RESUME SUMMARY:\n");
  console.log(response.choices[0].message.content);
}

main().catch((error) => {
  console.error("\nGROQ API TEST FAILED");
  if (error.status) console.error("HTTP status:", error.status);
  console.error("Error:", error.message);
  process.exitCode = 1;
});
