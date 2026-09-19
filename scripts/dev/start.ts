import { loadLocalConfig } from "./config";
import { composeArgs, runStep, superviseLocalProcesses } from "./process";

async function main() {
  const root = process.cwd();
  const config = await loadLocalConfig(root);
  runStep("Starting local PostgreSQL", "docker", [...composeArgs(config), "up", "-d", "--wait", "--wait-timeout", "60", "postgres"], root, config.env);
  console.log(`Local workspace: ${config.env.BETTER_AUTH_URL} (web + bulk worker; Ctrl+C stops both)`);
  superviseLocalProcesses(root, config);
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Local startup failed"); process.exitCode = 1; });
