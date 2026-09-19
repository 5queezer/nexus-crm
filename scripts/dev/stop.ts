import { loadLocalConfig } from "./config";
import { composeArgs, runStep } from "./process";

async function main() {
  const root = process.cwd();
  const config = await loadLocalConfig(root);
  runStep("Stopping local PostgreSQL (data volume retained)", "docker", [...composeArgs(config), "stop", "postgres"], root, config.env);
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Local shutdown failed"); process.exitCode = 1; });
