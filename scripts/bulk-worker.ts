import { prisma } from "../lib/prisma";
import { processBulkJobsOnce } from "../lib/agent/bulk/worker";

let stopping = false;
process.once("SIGINT", () => { stopping = true; });
process.once("SIGTERM", () => { stopping = true; });

async function main() {
  while (!stopping) {
    const processed = await processBulkJobsOnce();
    if (!processed) await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

main()
  .catch(() => {
    console.error("Bulk worker stopped unexpectedly");
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
