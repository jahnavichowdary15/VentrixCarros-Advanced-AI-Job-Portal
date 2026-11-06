const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

console.log("Resume model:", typeof prisma.resume);

prisma.$disconnect();
