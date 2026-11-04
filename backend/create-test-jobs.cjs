const { prisma } = require("./config/db");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");

async function main() {
    // Create a temporary company account for local testing.
    const email = `digest-test-company-${Date.now()}@example.com`;

    const passwordHash = await bcrypt.hash(
        crypto.randomBytes(32).toString("hex"),
        12
    );

    const company = await prisma.user.create({
        data: {
            name: "Ventrix Test Company",
            email,
            passwordHash,
            role: "COMPANY",
            isActive: true,
            emailVerified: true
        }
    });

    console.log("Temporary test company created:", company.name);

    const jobs = [
        {
            title: "Frontend Developer Intern",
            description: "Work with React, JavaScript, HTML and CSS.",
            requirements: "React, JavaScript, HTML, CSS",
            location: "Jaipur",
            workMode: "HYBRID",
            jobType: "INTERNSHIP",
            isActive: true,
            companyId: company.id
        },
        {
            title: "Backend Developer Intern",
            description: "Work with Node.js, Express.js, MySQL and APIs.",
            requirements: "Node.js, Express.js, MySQL",
            location: "Remote",
            workMode: "REMOTE",
            jobType: "INTERNSHIP",
            isActive: true,
            companyId: company.id
        },
        {
            title: "Full Stack Developer",
            description: "Develop web applications using React and Node.js.",
            requirements: "React, Node.js, JavaScript",
            location: "Jaipur",
            workMode: "ONSITE",
            jobType: "FULL_TIME",
            isActive: true,
            companyId: company.id
        }
    ];

    for (const job of jobs) {
        const created = await prisma.job.create({
            data: job
        });

        console.log("Created job:", created.title);
    }

    console.log("\nTest data created successfully.");
    console.log("Test company email:", email);
}

main()
    .catch((error) => {
        console.error("Test data creation failed:", error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
