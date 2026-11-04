const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const result = await prisma.job.updateMany({
    where: {
      id: "cmw0a5nyr0002ksu8l5nz7vqx"
    },
    data: {
      isActive: false
    }
  });

  console.log("Remaining jobs deactivated:", result.count);
}

main()
  .catch(console.error)
  .finally(async () => await prisma.$disconnect());
