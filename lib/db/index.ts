import type { DatabaseAdapter } from "./adapter";

export type { DatabaseAdapter } from "./adapter";
export * from "./types";

let instance: DatabaseAdapter | undefined;

export function getDb(): DatabaseAdapter {
  if (!instance) {
    const provider = process.env.DB_PROVIDER ?? "prisma";
    if (provider === "firestore") {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { FirestoreAdapter } = require("./firestore-adapter");
      instance = new FirestoreAdapter();
    } else {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { PrismaAdapter } = require("./prisma-adapter");
      instance = new PrismaAdapter();
    }
  }
  return instance!;
}
