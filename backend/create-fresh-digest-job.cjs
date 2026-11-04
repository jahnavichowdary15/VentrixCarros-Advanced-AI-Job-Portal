const { prisma } = require("./config/db");

async function main() {
  const company = await prisma.user.findFirst({
    where: {
      name: "Ventrix Test Company",
      role: "COMPANY"
    }
  });

  if (!company) {
    throw new Error("Existing Ventrix Test Company was not found.");
  }

  const job = await prisma.job.create({
    data: {
      title: `Automatic Digest Scheduler Test ${Date.now()}`,
      description: "Test opportunity for verifying automatic VentrixCarros daily job digest email delivery.",
      requirements: "JavaScript, React, Node.js",
      location: "Jaipur",
      workMode: "HYBRID",
      jobType: "INTERNSHIP",
      isActive: true,
      companyId: company.id
    }
  });

  console.log("Fresh test job created successfully:");
  console.log("Job ID:", job.id);
  console.log("Job title:", job.title);
  console.log("Created at:", job.createdAt);
}

main()
  .catch((error) => {
    console.error("Test job creation failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
