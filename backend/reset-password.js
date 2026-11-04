
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");
const readline = require("readline");

const prisma = new PrismaClient();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question) {
  return new Promise((resolve) => {
    rl.question(question, resolve);
  });
}

async function main() {
  const email = (
    await ask("Enter your registered email: ")
  ).trim().toLowerCase();

  const password = await ask(
    "Enter your NEW password (minimum 8 characters): "
  );

  if (password.length < 8) {
    console.log("Password must be at least 8 characters.");
    return;
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });

  if (!user) {
    console.log("Account not found. Check the registered email.");
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash },
  });

  console.log("Password updated successfully.");
  console.log("You can now try logging in with your new password.");
}

main()
  .catch((error) => {
    console.error("Password reset failed:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    rl.close();
    await prisma.$disconnect();
  });
