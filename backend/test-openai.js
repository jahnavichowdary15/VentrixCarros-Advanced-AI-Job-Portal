
require("dotenv").config();

const OpenAI = require("openai");

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function testOpenAI() {
  try {
    const response = await client.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-5.5",
      input: "Reply with exactly: VentrixCarros OpenAI connection successful",
    });

    console.log("OpenAI API test successful:");
    console.log(response.output_text);
  } catch (error) {
    console.error("OpenAI API test failed:");
    console.error("Status:", error.status || "unknown");
    console.error("Message:", error.message);
  }
}

testOpenAI();
