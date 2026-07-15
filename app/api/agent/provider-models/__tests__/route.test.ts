import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	requireAuth: vi.fn(),
	requireSessionAuth: vi.fn(),
	fetchModelsFromProviderApi: vi.fn(),
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
	SUPPORTED_PROVIDERS: [
		"openai",
		"anthropic",
		"kimi",
		"minimax",
		"deepseek",
		"openrouter",
	],
	fetchModelsFromProviderApi: mocks.fetchModelsFromProviderApi,
}));
import { POST } from "../route";

const session = { userId: "user-a", authType: "session" };
function request(
	body: BodyInit,
	headers = { "content-type": "application/json" },
) {
	return new Request("http://localhost/api/agent/provider-models", {
		method: "POST",
		headers,
		body,
	});
}

describe("POST /api/agent/provider-models", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.requireAuth.mockResolvedValue(session);
		mocks.requireSessionAuth.mockImplementation(async (options: unknown) =>
			(await mocks.requireAuth(options))?.authType === "session"
				? session
				: null,
		);
		mocks.loadCredentialSecret.mockResolvedValue(null);
		mocks.fetchModelsFromProviderApi.mockResolvedValue([
			{ id: "model-a", label: "Model A", description: "" },
		]);
	});

	it("loads models from a stored credential", async () => {
		mocks.loadCredentialSecret.mockResolvedValue({
			apiKey: "stored-secret-key",
			model: "gpt-5",
		});
		const response = await POST(
			request(JSON.stringify({ provider: "OPENAI" })),
		);
		expect(response.status).toBe(200);
		expect(mocks.fetchModelsFromProviderApi).toHaveBeenCalledWith(
			"openai",
			"stored-secret-key",
			{ onlyOpenRouterFree: undefined },
		);
	});

	it("prefers a submitted key without decrypting the stored credential", async () => {
		mocks.loadCredentialSecret.mockRejectedValue(new Error("broken envelope"));
		const response = await POST(
			request(
				JSON.stringify({ provider: "openai", apiKey: "submitted-secret" }),
			),
		);
		expect(response.status).toBe(200);
		expect(mocks.loadCredentialSecret).not.toHaveBeenCalled();
		expect(mocks.fetchModelsFromProviderApi).toHaveBeenCalledWith(
			"openai",
			"submitted-secret",
			{ onlyOpenRouterFree: undefined },
		);
	});

	it("returns controlled responses for missing, unsupported, decrypt, and upstream failures", async () => {
		expect(
			(await POST(request(JSON.stringify({ provider: "openai" })))).status,
		).toBe(400);
		expect(
			(
				await POST(
					request(
						JSON.stringify({ provider: "unknown", apiKey: "submitted-secret" }),
					),
				)
			).status,
		).toBe(400);
		mocks.loadCredentialSecret.mockRejectedValue(new Error("broken envelope"));
		expect(
			(await POST(request(JSON.stringify({ provider: "openai" })))).status,
		).toBe(400);
		mocks.fetchModelsFromProviderApi.mockRejectedValue(new Error("upstream"));
		expect(
			(
				await POST(
					request(
						JSON.stringify({ provider: "openai", apiKey: "submitted-secret" }),
					),
				)
			).status,
		).toBe(502);
	});

	it("rejects malformed and oversized JSON", async () => {
		expect((await POST(request("{"))).status).toBe(400);
		const oversized = JSON.stringify({
			provider: "openai",
			apiKey: "x".repeat(70_000),
		});
		expect((await POST(request(oversized))).status).toBe(413);
	});
});
