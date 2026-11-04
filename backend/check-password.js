
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");
const readline = require("readline");

const prisma = new PrismaClient();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

async function main() {
  const email = await new Promise((resolve) => {
    rl.question("Enter your registered email: ", resolve);
  });

  const password = await new Promise((resolve) => {
    rl.question("Enter your account password: ", resolve);
  });

  const user = await prisma.user.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: {
      id: true,
      passwordHash: true,
      emailVerified: true,
      isActive: true
    }
  });

  if (!user) {
    console.log("RESULT: ACCOUNT_NOT_FOUND");
    return;
  }

  const matches = await bcrypt.compare(
    password,
    user.passwordHash
  );

  console.log("Account found: YES");
  console.log("Email verified:", user.emailVerified);
  console.log("Account active:", user.isActive);
  console.log("Password matches:", matches ? "YES" : "NO");
}

main()
  .catch(() => {
    console.log("Diagnostic failed. Check your database connection.");
    process.exitCode = 1;
  })
  .finally(async () => {
    rl.close();
    await prisma.$disconnect();
  });
