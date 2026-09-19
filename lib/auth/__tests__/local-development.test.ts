import { describe, expect, it } from "vitest";
import {
  assertLocalDevelopmentEnvironment,
  isLocalDevelopmentAuthEnabled,
} from "../local-development";

const validEnvironment = {
  LOCAL_DEV_AUTH: "1",
  NODE_ENV: "development",
  DB_PROVIDER: "prisma",
  DATABASE_URL: "postgresql://nexus:nexus@127.0.0.1:55441/nexus_local_dev",
  BETTER_AUTH_URL: "http://localhost:3001",
} satisfies NodeJS.ProcessEnv;

describe("local development authentication guard", () => {
  it("enables credential authentication only for the dedicated local database", () => {
    expect(isLocalDevelopmentAuthEnabled(validEnvironment)).toBe(true);
  });

  it("stays disabled unless explicitly requested", () => {
    expect(isLocalDevelopmentAuthEnabled({ ...validEnvironment, LOCAL_DEV_AUTH: undefined })).toBe(false);
    expect(isLocalDevelopmentAuthEnabled({ ...validEnvironment, LOCAL_DEV_AUTH: "true" })).toBe(false);
  });

  it("stays disabled in production and rejects production when asserted", () => {
    const productionEnvironment = {
      ...validEnvironment,
      NODE_ENV: "production",
    } satisfies NodeJS.ProcessEnv;

    expect(isLocalDevelopmentAuthEnabled(productionEnvironment)).toBe(false);
    expect(() => assertLocalDevelopmentEnvironment(productionEnvironment)).toThrow(/development/i);
  });

  it.each([
    ["a remote database", { DATABASE_URL: "postgresql://nexus:nexus@db.example.com/nexus_local_dev" }],
    ["a different database", { DATABASE_URL: "postgresql://nexus:nexus@localhost/nexus" }],
    ["database query overrides", { DATABASE_URL: "postgresql://nexus:nexus@localhost/nexus_local_dev?schema=public" }],
    ["a non-Prisma adapter", { DB_PROVIDER: "firestore" }],
    ["a remote auth origin", { BETTER_AUTH_URL: "https://crm.example.com" }],
    ["an auth URL path", { BETTER_AUTH_URL: "http://localhost:3001/login" }],
    ["auth URL credentials", { BETTER_AUTH_URL: "http://user:password@localhost:3001" }],
    ["a cloud deployment", { VERCEL: "1" }],
  ])("rejects %s", (_name, override) => {
    expect(() => assertLocalDevelopmentEnvironment({ ...validEnvironment, ...override })).toThrow();
    expect(() => isLocalDevelopmentAuthEnabled({ ...validEnvironment, ...override })).toThrow();
  });

  it("accepts all supported loopback host forms", () => {
    for (const hostname of ["localhost", "127.0.0.1", "[::1]"]) {
      const environment = {
        ...validEnvironment,
        DATABASE_URL: `postgresql://nexus:nexus@${hostname}:55441/nexus_local_dev`,
        BETTER_AUTH_URL: `http://${hostname}:3001`,
      };

      expect(() => assertLocalDevelopmentEnvironment(environment)).not.toThrow();
    }
  });

  it.each([
    "CI", "VERCEL", "VERCEL_ENV", "NETLIFY", "RENDER", "RENDER_SERVICE_ID",
    "RAILWAY_ENVIRONMENT", "RAILWAY_ENVIRONMENT_ID", "RAILWAY_ENVIRONMENT_NAME",
    "RAILWAY_PROJECT_ID", "FLY_APP_NAME", "K_SERVICE", "CF_PAGES", "AWS_LAMBDA_FUNCTION_NAME",
  ])("still blocks local auth when %s is present", (marker) => {
    const environment = { ...validEnvironment, [marker]: "true" };
    expect(() => assertLocalDevelopmentEnvironment(environment)).toThrow(/cloud deployment/);
    expect(() => isLocalDevelopmentAuthEnabled(environment)).toThrow(/cloud deployment/);
  });
});
