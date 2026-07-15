import { createHash } from "node:crypto";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import { LRUCache } from "lru-cache";

type RequestMode = "api_key";

type CredentialSecret = {
	accessToken?: string;
	token?: string;
	apiKey?: string;
	api_key?: string;
};

export type SupportedProvider =
	| "openai"
	| "anthropic"
	| "kimi"
	| "minimax"
	| "deepseek"
	| "openrouter";
export const SUPPORTED_PROVIDERS: SupportedProvider[] = [
	"openai",
	"anthropic",
	"kimi",
	"minimax",
	"deepseek",
	"openrouter",
];

export type ModelOption = { id: string; label: string; description: string };
export type ProviderOption = {
	id: SupportedProvider;
	label: string;
	authMode: RequestMode;
	models: ModelOption[];
};

type ProviderModelOptions = {
	modelsUrl: string;
	includeOnlyFreeModels: boolean;
	requestHeaders?: Record<string, string>;
	authStyle?: "bearer" | "anthropic";
};

type ProviderCatalogDefinition = {
	id: SupportedProvider;
	label: string;
	authMode: RequestMode;
	createModel: (input: { apiKey: string; model: string }) => LanguageModel;
	modelOptions: ProviderModelOptions;
};

const MAX_PROVIDER_RESPONSE_BYTES = 1024 * 1024;
const MAX_PROVIDER_MODELS = 500;
const MAX_MODEL_ID_LENGTH = 256;
const MAX_MODEL_LABEL_LENGTH = 256;
const MAX_MODEL_DESCRIPTION_LENGTH = 2000;
const CACHE_TTL_MS = 90_000;
const MODEL_LIST_CACHE = new LRUCache<string, ModelOption[]>({
	max: 128,
	ttl: CACHE_TTL_MS,
});

function fromSecret(rawSecret: string): string {
	try {
		const payload = JSON.parse(rawSecret) as CredentialSecret;
		const token =
			payload.accessToken ?? payload.apiKey ?? payload.api_key ?? payload.token;
		if (typeof token === "string" && token) return token;
	} catch {
		/* legacy raw API key */
	}
	return rawSecret;
}

function boundedString(value: unknown, maximum: number): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed ? trimmed.slice(0, maximum) : null;
}

function extractModelList(payload: unknown): unknown[] {
	if (Array.isArray(payload)) return payload.slice(0, MAX_PROVIDER_MODELS);
	if (!payload || typeof payload !== "object") return [];
	const object = payload as {
		data?: unknown;
		models?: unknown;
		items?: unknown;
	};
	const list = Array.isArray(object.data)
		? object.data
		: Array.isArray(object.models)
			? object.models
			: Array.isArray(object.items)
				? object.items
				: [];
	return list.slice(0, MAX_PROVIDER_MODELS);
}

function parseModelId(candidate: Record<string, unknown>): string | null {
	return (
		boundedString(candidate.id, MAX_MODEL_ID_LENGTH) ??
		boundedString(candidate.model, MAX_MODEL_ID_LENGTH) ??
		boundedString(candidate.name, MAX_MODEL_ID_LENGTH)
	);
}

function isZeroPrice(value: unknown): boolean {
	if (typeof value === "number") return Number.isFinite(value) && value === 0;
	if (typeof value !== "string" || !value.trim()) return false;
	const parsed = Number(value.replace(/[,$\s]/g, ""));
	return Number.isFinite(parsed) && parsed === 0;
}

function inspectPriceLeaves(value: unknown): {
	hasPopulatedLeaf: boolean;
	allZero: boolean;
} {
	if (value === undefined || value === null || value === "") {
		return { hasPopulatedLeaf: false, allZero: true };
	}
	if (typeof value !== "object") {
		return { hasPopulatedLeaf: true, allZero: isZeroPrice(value) };
	}
	const children = Object.values(value);
	if (children.length === 0) return { hasPopulatedLeaf: false, allZero: true };
	return children.reduce(
		(result, child) => {
			const inspected = inspectPriceLeaves(child);
			return {
				hasPopulatedLeaf: result.hasPopulatedLeaf || inspected.hasPopulatedLeaf,
				allZero: result.allZero && inspected.allZero,
			};
		},
		{ hasPopulatedLeaf: false, allZero: true },
	);
}

function isOpenRouterFree(candidate: Record<string, unknown>): boolean {
	const pricing = candidate.pricing;
	if (!pricing || typeof pricing !== "object") return false;
	const inspected = inspectPriceLeaves(pricing);
	return inspected.hasPopulatedLeaf && inspected.allZero;
}

function normalizeCandidate(
	candidate: unknown,
	options: ProviderModelOptions,
): ModelOption | null {
	if (!candidate || typeof candidate !== "object") return null;
	const object = candidate as Record<string, unknown>;
	const id = parseModelId(object);
	if (!id || (options.includeOnlyFreeModels && !isOpenRouterFree(object)))
		return null;
	const label = boundedString(object.name, MAX_MODEL_LABEL_LENGTH) ?? id;
	const description =
		boundedString(object.description, MAX_MODEL_DESCRIPTION_LENGTH) ?? "";
	return { id, label, description };
}

function dedupeModels(models: ModelOption[]): ModelOption[] {
	const byId = new Map<string, ModelOption>();
	for (const model of models)
		if (!byId.has(model.id.toLowerCase()))
			byId.set(model.id.toLowerCase(), model);
	return [...byId.values()].sort((a, b) =>
		a.label.localeCompare(b.label, undefined, { sensitivity: "base" }),
	);
}

const MODEL_ENDPOINT_ORIGINS = new Set([
	"https://api.openai.com",
	"https://api.anthropic.com",
	"https://api.moonshot.ai",
	"https://api.minimax.io",
	"https://api.deepseek.com",
	"https://openrouter.ai",
]);

function getSafeModelsUrl(value: string): string {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error("Unsupported provider models endpoint");
	}
	if (url.protocol !== "https:" || !MODEL_ENDPOINT_ORIGINS.has(url.origin))
		throw new Error("Unsupported provider models endpoint");
	return url.toString();
}

function cacheKey(
	provider: SupportedProvider,
	key: string,
	freeOnly: boolean,
): string {
	return `${provider}:${freeOnly ? "free" : "all"}:${createHash("sha256").update(key).digest("hex")}`;
}

async function readBoundedProviderJson(response: Response): Promise<unknown> {
	if (!response.body) throw new Error("Provider returned an empty response");
	const declared = response.headers.get("content-length");
	if (declared && Number(declared) > MAX_PROVIDER_RESPONSE_BYTES)
		throw new Error("Provider response too large");
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > MAX_PROVIDER_RESPONSE_BYTES) {
			await reader.cancel().catch(() => undefined);
			throw new Error("Provider response too large");
		}
		chunks.push(value);
	}
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	try {
		return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
	} catch {
		throw new Error("Provider returned invalid JSON");
	}
}

const PROVIDERS: ProviderCatalogDefinition[] = [
	{
		id: "openai",
		label: "OpenAI",
		authMode: "api_key",
		createModel: ({ apiKey, model }) => createOpenAI({ apiKey })(model),
		modelOptions: {
			modelsUrl: "https://api.openai.com/v1/models",
			includeOnlyFreeModels: false,
		},
	},
	{
		id: "anthropic",
		label: "Anthropic",
		authMode: "api_key",
		createModel: ({ apiKey, model }) => createAnthropic({ apiKey })(model),
		modelOptions: {
			modelsUrl: "https://api.anthropic.com/v1/models",
			includeOnlyFreeModels: false,
			authStyle: "anthropic",
		},
	},
	{
		id: "kimi",
		label: "Kimi",
		authMode: "api_key",
		createModel: ({ apiKey, model }) =>
			createOpenAI({ apiKey, baseURL: "https://api.moonshot.ai/v1" })(model),
		modelOptions: {
			modelsUrl: "https://api.moonshot.ai/v1/models",
			includeOnlyFreeModels: false,
		},
	},
	{
		id: "minimax",
		label: "MiniMax",
		authMode: "api_key",
		createModel: ({ apiKey, model }) =>
			createOpenAI({ apiKey, baseURL: "https://api.minimax.io/v1" })(model),
		modelOptions: {
			modelsUrl: "https://api.minimax.io/v1/models",
			includeOnlyFreeModels: false,
		},
	},
	{
		id: "deepseek",
		label: "DeepSeek",
		authMode: "api_key",
		createModel: ({ apiKey, model }) =>
			createOpenAI({ apiKey, baseURL: "https://api.deepseek.com/v1" })(model),
		modelOptions: {
			modelsUrl: "https://api.deepseek.com/v1/models",
			includeOnlyFreeModels: false,
		},
	},
	{
		id: "openrouter",
		label: "OpenRouter",
		authMode: "api_key",
		createModel: ({ apiKey, model }) =>
			createOpenAI({
				apiKey,
				baseURL: "https://openrouter.ai/api/v1",
				headers: {
					"HTTP-Referer": process.env.APP_BASE_URL ?? "https://nexus-crm.local",
					"X-Title": process.env.APP_TITLE ?? "Nexus CRM",
				},
			})(model),
		modelOptions: {
			modelsUrl: "https://openrouter.ai/api/v1/models",
			includeOnlyFreeModels: false,
			requestHeaders: {
				"HTTP-Referer": process.env.APP_BASE_URL ?? "https://nexus-crm.local",
				"X-Title": process.env.APP_TITLE ?? "Nexus CRM",
			},
		},
	},
];

function getDefinition(provider: string): ProviderCatalogDefinition {
	const normalized = provider.trim().toLowerCase();
	const definition = PROVIDERS.find((item) => item.id === normalized);
	if (!definition) throw new Error("Unsupported provider");
	return definition;
}

async function fetchModelsFromProvider(
	provider: ProviderCatalogDefinition,
	credential: string,
): Promise<ModelOption[]> {
	const key = fromSecret(credential);
	if (!key) return [];
	const cacheId = cacheKey(
		provider.id,
		key,
		provider.modelOptions.includeOnlyFreeModels,
	);
	const cached = MODEL_LIST_CACHE.get(cacheId);
	if (cached) return cached;
	const headers: Record<string, string> =
		provider.modelOptions.authStyle === "anthropic"
			? { "x-api-key": key, "anthropic-version": "2023-06-01" }
			: { Authorization: `Bearer ${key}` };
	Object.assign(headers, provider.modelOptions.requestHeaders);
	const response = await fetch(
		getSafeModelsUrl(provider.modelOptions.modelsUrl),
		{
			method: "GET",
			headers,
			cache: "no-store",
			redirect: "error",
			signal: AbortSignal.timeout(10_000),
		},
	);
	if (!response.ok) throw new Error("Provider model request failed");
	const payload = await readBoundedProviderJson(response);
	const models = dedupeModels(
		extractModelList(payload)
			.map((item) => normalizeCandidate(item, provider.modelOptions))
			.filter((item): item is ModelOption => item !== null),
	);
	MODEL_LIST_CACHE.set(cacheId, models);
	return models;
}

export async function listProviderOptions(input?: {
	providerSecrets?: Partial<Record<string, string>>;
}): Promise<ProviderOption[]> {
	return Promise.all(
		PROVIDERS.map(async (provider) => {
			let models: ModelOption[] = [];
			const secret = input?.providerSecrets?.[provider.id];
			if (secret)
				try {
					models = await fetchModelsFromProvider(provider, secret);
				} catch {
					models = [];
				}
			return {
				id: provider.id,
				label: provider.label,
				authMode: provider.authMode,
				models,
			};
		}),
	);
}

export function getProviderConfig(provider: string): ProviderCatalogDefinition {
	return getDefinition(provider);
}

export function createUserLanguageModel(input: {
	provider: string;
	model: string;
	apiKey: string;
}): LanguageModel {
	const definition = getDefinition(input.provider);
	return definition.createModel({
		apiKey: fromSecret(input.apiKey),
		model: input.model,
	});
}

export async function fetchModelsFromProviderApi(
	provider: string,
	credential: string,
	options?: { onlyOpenRouterFree?: boolean },
) {
	const definition = getDefinition(provider);
	if (definition.id === "openrouter" && options?.onlyOpenRouterFree) {
		return fetchModelsFromProvider(
			{
				...definition,
				modelOptions: {
					...definition.modelOptions,
					includeOnlyFreeModels: true,
				},
			},
			credential,
		);
	}
	return fetchModelsFromProvider(definition, credential);
}

export function clearProviderModelCacheForTests(): void {
	MODEL_LIST_CACHE.clear();
}
