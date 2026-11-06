require("dotenv").config();

const OpenAI = require("openai").default;

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is missing from .env");
  }

  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  });

  console.log("Sending test request to OpenAI...");

  const response = await client.responses.create({
    model: "gpt-6-astra",
    input: "Reply with exactly: VentrixCarros AI connection successful."
  });

  console.log("\nAPI TEST SUCCESSFUL");
  console.log("OpenAI response:", response.output_text);
}

main().catch((error) => {
  console.error("\nAPI TEST FAILED");

  if (error.status) {
    console.error("HTTP status:", error.status);
  }

  console.error("Error:", error.message);
  process.exitCode = 1;
});
