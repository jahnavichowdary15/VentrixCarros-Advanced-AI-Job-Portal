const { prisma } = require("./config/db");

async function main() {
    const users = await prisma.user.groupBy({
        by: ["role", "isActive"],
        _count: {
            id: true
        }
    });

    console.log(JSON.stringify(users, null, 2));
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
