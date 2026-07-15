import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	requireAuth: vi.fn(),
	requireSessionAuth: vi.fn(),
	fetchModelsFromProviderApi: vi.fn(),
	getProviderConfig: vi.fn(),
	loadCredentialSecret: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
	requireAuth: mocks.requireAuth,
	requireSessionAuth: mocks.requireSessionAuth,
}));

vi.mock("@/lib/agent/credentials", () => ({
	prismaCredentialRepository: {},
	loadCredentialSecret: mocks.loadCredentialSecret,
}));

vi.mock("@/lib/agent/providers", () => ({
	fetchModelsFromProviderApi: mocks.fetchModelsFromProviderApi,
	getProviderConfig: mocks.getProviderConfig,
}));

import { POST } from "../route";

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

describe("POST /api/agent/provider-models", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.requireAuth.mockResolvedValue(session);
		mocks.requireSessionAuth.mockImplementation(async (options) => {
			const authResult = await mocks.requireAuth(options);
			return authResult?.authType === "session" ? authResult : null;
		});

		mocks.loadCredentialSecret.mockResolvedValue(null);
		mocks.fetchModelsFromProviderApi.mockResolvedValue([
			{ id: "model-a", label: "Model A", description: "" },
		]);
	});

	it("loads models from stored API-key credential when no key is submitted", async () => {
		mocks.getProviderConfig.mockReturnValue({
			id: "openai",
			authMode: "api_key",
		});
		mocks.loadCredentialSecret.mockResolvedValue({
			apiKey: "stored-secret-key",
			model: "gpt-5",
		});

		const response = await POST(
			new Request("http://localhost/api/agent/provider-models", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ provider: "openai" }),
			}),
		);
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(mocks.fetchModelsFromProviderApi).toHaveBeenCalledWith(
			"openai",
			"stored-secret-key",
			{
				onlyOpenRouterFree: undefined,
			},
		);
		expect(body.models).toEqual([
			{ id: "model-a", label: "Model A", description: "" },
		]);
	});

	it("rejects API-key providers when neither submitted key nor stored key exists", async () => {
		mocks.getProviderConfig.mockReturnValue({
			id: "openai",
			authMode: "api_key",
		});
		const response = await POST(
			new Request("http://localhost/api/agent/provider-models", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ provider: "openai" }),
			}),
		);

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			error: "API key is required for this provider",
		});
	});

	it("loads OAuth provider models from stored credential", async () => {
		mocks.getProviderConfig.mockReturnValue({
			id: "chatgpt",
			authMode: "oauth",
		});
		mocks.loadCredentialSecret.mockResolvedValue({
			apiKey: "oauth-token",
			model: "gpt-5",
		});

		const response = await POST(
			new Request("http://localhost/api/agent/provider-models", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ provider: "chatgpt" }),
			}),
		);

		expect(response.status).toBe(200);
		expect(mocks.fetchModelsFromProviderApi).toHaveBeenCalledWith(
			"chatgpt",
			"oauth-token",
			{
				onlyOpenRouterFree: undefined,
			},
		);
	});
});
