require("dotenv").config();

const OpenAI = require("openai").default;

async function main() {
  const client = new OpenAI({
    apiKey: process.env.GROQ_API_KEY,
    baseURL: "https://api.groq.com/openai/v1"
  });

  console.log("Checking available Groq models...\n");

  const result = await client.models.list();

  result.data
    .filter(model => model.active !== false)
    .forEach(model => console.log(model.id));
}

main().catch(error => {
  console.error("MODEL LIST FAILED");
  console.error("Status:", error.status || "Unknown");
  console.error("Error:", error.message);
});
