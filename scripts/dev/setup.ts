import path from "node:path";
import { ensureLocalConfig } from "./config";
import { composeArgs, runStep } from "./process";
import { seedLocalData } from "./seed-data";

async function main() {
  const root = process.cwd();
  const config = await ensureLocalConfig(root);
  runStep("Starting local PostgreSQL", "docker", [...composeArgs(config), "up", "-d", "--wait", "--wait-timeout", "60", "postgres"], root, config.env);
  const prismaCLI = path.join(root, "node_modules/prisma/build/index.js");
  runStep("Generating Prisma client", process.execPath, [prismaCLI, "generate"], root, config.env);
  runStep("Applying committed migrations", process.execPath, [prismaCLI, "migrate", "deploy"], root, config.env);
  Object.assign(process.env, config.env);
  const { prisma } = await import("../../lib/prisma");
  try {
    const { auth } = await import("../../lib/auth");
    const context = await auth.$context;
    const accounts = await seedLocalData(prisma, body => auth.api.signUpEmail({ body }), config.env, context.password.verify);
    console.log(`Local profile ready at ${config.env.BETTER_AUTH_URL}`);
    for (const account of accounts) console.log(`${account.isAdmin ? "Admin" : "Regular user"}: ${account.email}`);
    console.log("Passwords: .env.local → LOCAL_DEV_ADMIN_PASSWORD / LOCAL_DEV_USER_PASSWORD");
    console.log("Start web and worker: npm run dev:local");
  } finally { await prisma.$disconnect(); }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error && !/[\r\n]/.test(error.message) && error.message.length < 250 ? error.message : "Local setup failed. Configuration and existing data were retained.");
  process.exitCode = 1;
});
