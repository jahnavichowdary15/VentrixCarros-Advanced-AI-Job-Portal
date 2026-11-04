const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function main() {
  const result = await prisma.job.updateMany({
    where: {
      id: {
        in: [
          "cmw1123ml0001ks1c1lpxh2aq",
          "cmw0a5nzc0006ksu81zc1f3w2",
          "cmw0a5nz20004ksu8yiu679k9",
          "cmw0a5nyr0002ksu836m8ly1e"
        ]
      }
    },
    data: {
      isActive: false
    }
  });

  console.log("Jobs deactivated:", result.count);
}

main()
  .catch(error => {
    console.error("Error:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
