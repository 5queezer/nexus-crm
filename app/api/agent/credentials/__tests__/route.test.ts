import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  requireSessionAuth: vi.fn(),
  getCredentialMetadata: vi.fn(),
  saveCredential: vi.fn(),
  deleteCredential: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  requireAuth: mocks.requireAuth,
  requireSessionAuth: mocks.requireSessionAuth,
}));
vi.mock("@/lib/agent/credentials", () => ({
  prismaCredentialRepository: {},
  getCredentialMetadata: mocks.getCredentialMetadata,
  saveCredential: mocks.saveCredential,
  deleteCredential: mocks.deleteCredential,
}));

import { DELETE, GET, PUT } from "../route";

const session = {
  userId: "user-a",
  readScopeUserId: "user-a",
  user: { id: "user-a", name: null, email: "a@example.com", image: null, isAdmin: false },
  authType: "session",
};

describe("/api/agent/credentials", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue(session);
    mocks.requireSessionAuth.mockImplementation(async (options) => {
      const authResult = await mocks.requireAuth(options);
      return authResult?.authType === "session" ? authResult : null;
    });
    mocks.getCredentialMetadata.mockResolvedValue(null);
  });

  it("requires real authentication", async () => {
    mocks.requireAuth.mockResolvedValue(null);
    const response = await GET();
    expect(response.status).toBe(401);
    expect(mocks.requireSessionAuth).toHaveBeenCalledWith({ allowDevBypass: false });
  });

  it("rejects bearer-token authentication", async () => {
    mocks.requireAuth.mockResolvedValue({ ...session, authType: "api_token" });
    const response = await GET();
    expect(response.status).toBe(401);
    expect(mocks.getCredentialMetadata).not.toHaveBeenCalled();
  });

  it("returns provider options and metadata without raw keys", async () => {
    mocks.getCredentialMetadata.mockImplementation(async (_repo, _user, provider) =>
      provider === "openai"
        ? { id: "cred-1", provider, defaultModel: "gpt-5.4-mini", keyHint: "••••1234", status: "configured" }
        : null,
    );

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.providers).toHaveLength(2);
    expect(body.credentials[0].keyHint).toBe("••••1234");
    expect(JSON.stringify(body)).not.toContain("apiKey");
  });

  it("stores a credential for the authenticated user without echoing the submitted key", async () => {
    mocks.saveCredential.mockResolvedValue({
      id: "cred-1",
      provider: "openai",
      defaultModel: "gpt-5.4-mini",
      keyHint: "••••cret",
      status: "configured",
    });
    const response = await PUT(
      new Request("http://localhost/api/agent/credentials", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: "openai", model: "gpt-5.4-mini", apiKey: "sk-super-secret" }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.saveCredential).toHaveBeenCalledWith(
      expect.anything(),
      "user-a",
      expect.objectContaining({ provider: "openai" }),
    );
    expect(JSON.stringify(body)).not.toContain("sk-super-secret");
  });

  it("deletes only the authenticated user's provider credential", async () => {
    mocks.deleteCredential.mockResolvedValue(true);
    const response = await DELETE(
      new Request("http://localhost/api/agent/credentials?provider=openai", { method: "DELETE" }),
    );

    expect(response.status).toBe(204);
    expect(mocks.deleteCredential).toHaveBeenCalledWith(expect.anything(), "user-a", "openai");
  });
});
