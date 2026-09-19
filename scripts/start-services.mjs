import { spawn } from "node:child_process";

const services = [
  { name: "web", child: spawn(process.execPath, ["server.js"], { stdio: "inherit", env: process.env }) },
  { name: "bulk-worker", child: spawn(process.execPath, ["scripts/bulk-worker.cjs"], { stdio: "inherit", env: process.env }) },
];

let stopping = false;

function stop(signal) {
  if (stopping) return;
  stopping = true;
  for (const { child } of services) {
    if (child.exitCode === null && child.signalCode === null) child.kill(signal);
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => stop(signal));
}

for (const { name, child } of services) {
  child.once("error", () => {
    console.error(`${name} service could not start`);
    process.exitCode = 1;
    stop("SIGTERM");
  });
  child.once("exit", (code, signal) => {
    if (!stopping) {
      console.error(`${name} service stopped unexpectedly`);
      process.exitCode = code && code > 0 ? code : 1;
      stop("SIGTERM");
      return;
    }
    if (services.every((service) => service.child.exitCode !== null || service.child.signalCode !== null)) {
      process.exit(process.exitCode ?? (signal ? 0 : code ?? 0));
    }
  });
}
