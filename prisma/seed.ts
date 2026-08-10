import { getDb } from "../lib/db";
import type { DatabaseAdapter } from "../lib/db/adapter";
import { createDemoFixtures } from "../lib/demo-workspace/fixtures";

interface SeedEnvironment {
  NODE_ENV?: string;
  DEMO_SEED_ENABLED?: string;
  DEMO_SEED_USER_ID?: string;
  VERCEL_ENV?: string;
  RAILWAY_ENVIRONMENT_NAME?: string;
  FLY_APP_NAME?: string;
  K_SERVICE?: string;
}

type DemoLifecycleAdapter = Pick<DatabaseAdapter, "ensureDemoWorkspace">;

function isProductionEnvironment(env: SeedEnvironment): boolean {
  return env.NODE_ENV === "production"
    || env.VERCEL_ENV === "production"
    || env.RAILWAY_ENVIRONMENT_NAME === "production"
    || Boolean(env.FLY_APP_NAME)
    || Boolean(env.K_SERVICE);
}

export async function runDemoSeed(
  env: SeedEnvironment = process.env,
  resolveAdapter: () => DemoLifecycleAdapter = getDb,
) {
  if (isProductionEnvironment(env)) {
    throw new Error("Demo seed is blocked in production environments");
  }
  if (env.DEMO_SEED_ENABLED !== "true") {
    throw new Error("DEMO_SEED_ENABLED=true is required");
  }
  const userId = env.DEMO_SEED_USER_ID?.trim();
  if (!userId) {
    throw new Error("DEMO_SEED_USER_ID is required");
  }

  return resolveAdapter().ensureDemoWorkspace(userId, createDemoFixtures());
}

async function main() {
  const result = await runDemoSeed();
  console.log(
    result.replayed
      ? `Demo workspace already exists for ${process.env.DEMO_SEED_USER_ID}; replayed safely.`
      : `Created ${result.applications.length} demo applications for ${process.env.DEMO_SEED_USER_ID}.`,
  );
}

if (!process.env.VITEST) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
