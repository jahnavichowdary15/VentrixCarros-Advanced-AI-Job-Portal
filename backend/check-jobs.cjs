const { prisma } = require("./config/db");

async function main() {
    const jobs = await prisma.job.findMany({
        select: {
            id: true,
            title: true,
            isActive: true,
            expiresAt: true
        },
        orderBy: {
            createdAt: "desc"
        }
    });

    console.log(JSON.stringify(jobs, null, 2));
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
