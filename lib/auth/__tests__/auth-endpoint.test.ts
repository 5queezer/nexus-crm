import { afterEach, describe, expect, it, vi } from "vitest";

describe("Better Auth production endpoints", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("rejects email sign-in in production even when LOCAL_DEV_AUTH is set", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LOCAL_DEV_AUTH", "1");
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3001");
    vi.stubEnv("BETTER_AUTH_SECRET", "local-test-secret-that-is-at-least-32-bytes");
    vi.stubEnv("DATABASE_URL", "postgresql://nexus:nexus@127.0.0.1:55441/nexus_local_dev");
    vi.stubEnv("GOOGLE_CLIENT_ID", "test-google-client");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "test-google-secret");

    const { auth } = await import("../../auth");
    const response = await auth.handler(new Request(
      "http://localhost:3001/api/auth/sign-in/email",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3001",
          "x-forwarded-for": "127.0.0.1",
        },
        body: JSON.stringify({
          email: "dev@example.test",
          password: "local-password",
          callbackURL: "http://localhost:3001/",
        }),
      },
    ));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      code: "EMAIL_PASSWORD_DISABLED",
    });
  });
});
