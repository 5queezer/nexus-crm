import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	requireAuth: vi.fn(),
	requireSessionAuth: vi.fn(),
	getCredentialMetadata: vi.fn(),
	listUserCredentials: vi.fn(),
	getCredentialSecret: vi.fn(),
	saveCredential: vi.fn(),
	deleteCredential: vi.fn(),
	listProviderOptions: vi.fn(),
	getProviderConfig: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
	requireAuth: mocks.requireAuth,
	requireSessionAuth: mocks.requireSessionAuth,
}));
vi.mock("@/lib/agent/credentials", () => ({
	prismaCredentialRepository: {},
	listUserCredentials: mocks.listUserCredentials,
	getCredentialSecret: mocks.getCredentialSecret,
	getCredentialMetadata: mocks.getCredentialMetadata,
	saveCredential: mocks.saveCredential,
	deleteCredential: mocks.deleteCredential,
}));

vi.mock("@/lib/agent/providers", () => ({
	SUPPORTED_PROVIDERS: [
		"openai",
		"anthropic",
		"kimi",
		"minimax",
		"deepseek",
		"openrouter",
	],
	getProviderConfig: mocks.getProviderConfig,
	listProviderOptions: mocks.listProviderOptions,
}));

import { DELETE, GET, PUT } from "../route";

const session = {
	userId: "user-a",
	readScopeUserId: "user-a",
	user: {
		id: "user-a",
		name: null,
		email: "a@example.com",
		image: null,
		isAdmin: false,
	},
	authType: "session",
};

describe("/api/agent/credentials", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.requireAuth.mockResolvedValue(session);
		mocks.requireSessionAuth.mockImplementation(async (options: unknown) => {
			const authResult = await mocks.requireAuth(options);
			return authResult?.authType === "session" ? authResult : null;
		});
		mocks.getCredentialMetadata.mockResolvedValue(null);
		mocks.getCredentialSecret.mockResolvedValue("stored-secret");
		mocks.listUserCredentials.mockResolvedValue([
			{
				id: "cred-1",
				userId: "user-a",
				provider: "openai",
				encryptedApiKey: "encrypted",
				keyHint: "••••1234",
				defaultModel: "gpt-5.4-mini",
				status: "configured",
				lastValidatedAt: new Date(),
				createdAt: new Date(),
				updatedAt: new Date(),
			},
		]);
		mocks.listProviderOptions.mockResolvedValue([
			{
				id: "openai",
				label: "OpenAI",
				authMode: "api_key",
				models: [{ id: "gpt", label: "GPT", description: "" }],
			},
			{
				id: "anthropic",
				label: "Anthropic",
				authMode: "api_key",
				models: [{ id: "claude", label: "Claude", description: "" }],
			},
		]);
		mocks.getProviderConfig.mockImplementation((provider: string) => ({
			id: String(provider),
			authMode: "api_key",
			label: provider,
			createModel: () => {
				throw new Error("not used");
			},
			modelOptions: { modelsUrl: "", includeOnlyFreeModels: false },
		}));
	});

	it("requires real authentication", async () => {
		mocks.requireAuth.mockResolvedValue(null);
		const response = await GET();
		expect(response.status).toBe(401);
		expect(mocks.requireSessionAuth).toHaveBeenCalledWith({
			allowDevBypass: false,
		});
	});

	it("rejects bearer-token authentication", async () => {
		mocks.requireAuth.mockResolvedValue({ ...session, authType: "api_token" });
		const response = await GET();
		expect(response.status).toBe(401);
		expect(mocks.getCredentialMetadata).not.toHaveBeenCalled();
	});

	it("returns provider options and metadata without raw keys", async () => {
		const response = await GET();
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.providers.length).toBeGreaterThan(0);
		expect(body.credentials).toHaveLength(1);
		expect(body.credentials[0].keyHint).toBe("••••1234");
		expect(JSON.stringify(body)).not.toContain("apiKey");
		expect(mocks.getCredentialSecret).not.toHaveBeenCalled();
		expect(mocks.listProviderOptions).toHaveBeenCalledWith();
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
				body: JSON.stringify({
					provider: "openai",
					model: "gpt-5.4-mini",
					apiKey: "sk-super-secret",
				}),
			}),
		);
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(mocks.saveCredential).toHaveBeenCalledWith(
			expect.anything(),
			"user-a",
			expect.objectContaining({ provider: "openai" }),
		);
		expect(mocks.getProviderConfig).toHaveBeenCalledWith("openai");
		expect(JSON.stringify(body)).not.toContain("sk-super-secret");
	});

	it("allows updating an existing model without resubmitting the key", async () => {
		mocks.getCredentialMetadata.mockResolvedValue({
			id: "cred-1",
			provider: "openai",
			defaultModel: "old",
			keyHint: "••••1234",
			status: "configured",
		});
		mocks.saveCredential.mockResolvedValue({
			id: "cred-1",
			provider: "openai",
			defaultModel: "new",
			keyHint: "••••1234",
			status: "configured",
		});
		const response = await PUT(
			new Request("http://localhost/api/agent/credentials", {
				method: "PUT",
				body: JSON.stringify({ provider: "OPENAI", model: "new" }),
			}),
		);
		expect(response.status).toBe(200);
		expect(mocks.saveCredential).toHaveBeenCalledWith(
			expect.anything(),
			"user-a",
			{ provider: "openai", model: "new" },
		);
	});

	it("requires a key for first-time configuration", async () => {
		const response = await PUT(
			new Request("http://localhost/api/agent/credentials", {
				method: "PUT",
				body: JSON.stringify({ provider: "openai", model: "new" }),
			}),
		);
		expect(response.status).toBe(400);
	});

	it("deletes only the authenticated user's provider credential", async () => {
		mocks.getCredentialMetadata.mockResolvedValue({
			id: "cred-1",
			provider: "openai",
			defaultModel: "gpt-5.4-mini",
			keyHint: "••••1234",
			status: "configured",
		});
		mocks.deleteCredential.mockResolvedValue(true);
		const response = await DELETE(
			new Request("http://localhost/api/agent/credentials?provider=openai", {
				method: "DELETE",
			}),
		);

		expect(response.status).toBe(204);
		expect(mocks.deleteCredential).toHaveBeenCalledWith(
			expect.anything(),
			"user-a",
			"openai",
		);
	});
});
