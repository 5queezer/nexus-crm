import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  betterAuth: vi.fn(),
  prismaAdapter: vi.fn(() => ({ adapter: "prisma" })),
}));

vi.mock("better-auth", () => ({ betterAuth: mocks.betterAuth }));
vi.mock("better-auth/adapters/prisma", () => ({ prismaAdapter: mocks.prismaAdapter }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

describe("Better Auth local credential configuration", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.betterAuth.mockReturnValue({ handler: vi.fn() });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("keeps the email sign-in endpoint disabled in production even if the flag is set", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LOCAL_DEV_AUTH", "1");

    await import("../../auth");

    expect(mocks.betterAuth).toHaveBeenCalledOnce();
    expect(mocks.betterAuth.mock.calls[0]?.[0]).toMatchObject({
      emailAndPassword: { enabled: false },
    });
  });

  it("enables email sign-in and omits an unconfigured Google provider locally", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("LOCAL_DEV_AUTH", "1");
    vi.stubEnv("DB_PROVIDER", "prisma");
    vi.stubEnv("DATABASE_URL", "postgresql://nexus:nexus@localhost:55441/nexus_local_dev");
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3001");
    vi.stubEnv("GOOGLE_CLIENT_ID", "");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "");

    await import("../../auth");

    expect(mocks.betterAuth.mock.calls[0]?.[0]).toMatchObject({
      emailAndPassword: { enabled: true },
      socialProviders: {},
    });
  });
});
