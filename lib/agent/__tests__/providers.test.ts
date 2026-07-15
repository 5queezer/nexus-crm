import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	clearProviderModelCacheForTests,
	fetchModelsFromProviderApi,
} from "../providers";

function modelsResponse(data: unknown, init?: ResponseInit) {
	return new Response(JSON.stringify({ data }), {
		status: 200,
		headers: { "content-type": "application/json" },
		...init,
	});
}

describe("provider model discovery", () => {
	beforeEach(() => {
		clearProviderModelCacheForTests();
		vi.restoreAllMocks();
	});

	it("uses Anthropic headers and rejects redirects", async () => {
		const fetchMock = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(modelsResponse([{ id: "claude" }]));
		await fetchModelsFromProviderApi("anthropic", "anthropic-secret");
		const [url, init] = fetchMock.mock.calls[0]!;
		expect(url).toBe("https://api.anthropic.com/v1/models");
		expect(init).toMatchObject({ redirect: "error" });
		expect(init?.headers).toMatchObject({
			"x-api-key": "anthropic-secret",
			"anthropic-version": "2023-06-01",
		});
		expect(init?.headers).not.toHaveProperty("Authorization");
	});

	it.each([
		["kimi", "https://api.moonshot.ai/v1/models"],
		["minimax", "https://api.minimax.io/v1/models"],
	] as const)("uses the global %s endpoint", async (provider, expectedUrl) => {
		const fetchMock = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(modelsResponse([]));
		await fetchModelsFromProviderApi(provider, `${provider}-secret`);
		expect(fetchMock.mock.calls[0]?.[0]).toBe(expectedUrl);
		expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ redirect: "error" });
	});

	it("only includes models whose applicable pricing dimensions are all zero", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			modelsResponse([
				{ id: "free", pricing: { prompt: "0", completion: "0", request: "0" } },
				{
					id: "mixed-prompt",
					pricing: { prompt: "0", completion: "0.1", request: "0" },
				},
				{
					id: "mixed-cache",
					pricing: { prompt: "0.1", completion: "0", prompt_cache_hit: "0" },
				},
				{
					id: "free-nested",
					pricing: {
						prompt: "0",
						web_search: "0",
						audio: { input: "0", output: 0 },
						cache: { read: "0", write: "0" },
						overrides: { providerA: { output: "0" } },
					},
				},
				{ id: "paid-web-search", pricing: { prompt: "0", web_search: "0.01" } },
				{
					id: "paid-nested-override",
					pricing: {
						prompt: "0",
						overrides: { providerA: { output: "0.02" } },
					},
				},
				{ id: "unknown-leaf", pricing: { prompt: "0", audio: "included" } },
				{ id: "unknown", pricing: {} },
			]),
		);
		const models = await fetchModelsFromProviderApi(
			"openrouter",
			"router-secret",
			{ onlyOpenRouterFree: true },
		);
		expect(models.map((model) => model.id)).toEqual(["free", "free-nested"]);
	});

	it("redacts upstream failures and separates cache entries by credential", async () => {
		const fetchMock = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValueOnce(modelsResponse([{ id: "one" }]))
			.mockResolvedValueOnce(modelsResponse([{ id: "two" }]))
			.mockResolvedValueOnce(new Response("secret-key-leak", { status: 401 }));
		expect(
			(await fetchModelsFromProviderApi("openai", "key-one-123")).map(
				(model) => model.id,
			),
		).toEqual(["one"]);
		expect(
			(await fetchModelsFromProviderApi("openai", "key-two-123")).map(
				(model) => model.id,
			),
		).toEqual(["two"]);
		await expect(
			fetchModelsFromProviderApi("openai", "key-three-123"),
		).rejects.toThrow("Provider model request failed");
		expect(fetchMock).toHaveBeenCalledTimes(3);
	});

	it("rejects oversized provider responses", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response("x", {
				status: 200,
				headers: { "content-length": String(1024 * 1024 + 1) },
			}),
		);
		await expect(
			fetchModelsFromProviderApi("openai", "oversized-key"),
		).rejects.toThrow("Provider response too large");
	});
});
