import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import type { LocalConfig } from "./config";

export function runStep(label: string, command: string, args: string[], root: string, env: NodeJS.ProcessEnv) {
  console.log(label);
  const result = spawnSync(command, args, { cwd: root, env, stdio: "inherit", shell: false });
  if (result.error || result.status !== 0) throw new Error(`${label} failed. Check the output above; existing configuration and data were retained.`);
}

export function composeArgs(config: LocalConfig): string[] {
  return ["--context", "default", "compose", "--project-name", config.env.LOCAL_DEV_PROJECT!, "--env-file", config.file, "-f", "compose.local.yml"];
}

export function superviseLocalProcesses(root: string, config: LocalConfig) {
  const web = spawn(process.execPath, [path.join(root, "node_modules/next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", "--port", String(config.port)], { cwd: root, env: config.env, stdio: "inherit" });
  const worker = spawn(process.execPath, ["--import", "tsx", "scripts/bulk-worker.ts"], { cwd: root, env: config.env, stdio: "inherit" });
  const children = [web, worker];
  let stopping = false;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  function stop() {
    if (stopping) return;
    stopping = true;
    for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    deadline = setTimeout(() => {
      for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }, 10_000);
    deadline.unref();
  }
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  for (const child of children) {
    child.once("error", () => { process.exitCode = 1; stop(); });
    child.once("exit", (code) => {
      if (!stopping) { process.exitCode = code || 1; stop(); }
      if (children.every(item => item.exitCode !== null || item.signalCode !== null)) {
        if (deadline) clearTimeout(deadline);
        process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop);
      }
    });
  }
}
