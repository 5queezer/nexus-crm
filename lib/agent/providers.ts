import { createHash, randomBytes } from "node:crypto";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

type RequestMode = "api_key" | "oauth";

type CredentialSecret = {
	accessToken?: string;
	token?: string;
	apiKey?: string;
	api_key?: string;
	model?: string;
};

export type SupportedProvider =
	| "openai"
	| "chatgpt"
	| "anthropic"
	| "kimi"
	| "minimax"
	| "deepseek"
	| "openrouter";

export const SUPPORTED_PROVIDERS: SupportedProvider[] = [
	"openai",
	"chatgpt",
	"anthropic",
	"kimi",
	"minimax",
	"deepseek",
	"openrouter",
];

export type ModelOption = {
	id: string;
	label: string;
	description: string;
};

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
	parseLabel?: (candidate: unknown) => string | null;
	parseDescription?: (candidate: unknown, modelId: string) => string;
};

type ProviderCatalogDefinition = {
	id: SupportedProvider;
	label: string;
	authMode: RequestMode;
	createModel: (input: { apiKey: string; model: string }) => LanguageModel;
	modelOptions: ProviderModelOptions;
};

function fromSecret(rawSecret: string): string {
	try {
		const payload = JSON.parse(rawSecret) as CredentialSecret;
		const token =
			payload.accessToken ?? payload.apiKey ?? payload.api_key ?? payload.token;
		if (typeof token === "string" && token) {
			return token;
		}
	} catch {
		// keep support for legacy raw-api-key secrets
	}
	return rawSecret;
}

function now(): number {
	return Date.now();
}

function normalizeModelId(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed ? trimmed : null;
}

function parseDescriptionFromObject(
	candidate: Record<string, unknown>,
): string {
	const parts: string[] = [];
	const contextLength = candidate.context_length;
	const context =
		typeof contextLength === "number"
			? contextLength
			: typeof contextLength === "string" && contextLength.trim()
				? Number(contextLength)
				: NaN;

	if (Number.isFinite(context)) {
		parts.push(`${context.toLocaleString()} context`);
	}

	if (typeof candidate.provider === "string" && candidate.provider) {
		parts.push(`provider ${candidate.provider}`);
	}

	if (
		typeof candidate.architecture === "object" &&
		candidate.architecture !== null
	) {
		const maxTokens = (candidate.architecture as { maxTokens?: unknown })
			.maxTokens;
		if (typeof maxTokens === "number" && Number.isFinite(maxTokens)) {
			parts.push(`${maxTokens.toLocaleString()} max tokens`);
		}
	}

	const description =
		typeof candidate.description === "string" && candidate.description.trim()
			? candidate.description.trim()
			: null;
	if (description) return description;
	return parts.join(" • ");
}

function extractModelList(payload: unknown): unknown[] {
	if (!payload) return [];
	if (Array.isArray(payload)) return payload;
	if (Array.isArray((payload as { data?: unknown[] }).data)) {
		return (payload as { data: unknown[] }).data;
	}
	if (Array.isArray((payload as { models?: unknown[] }).models)) {
		return (payload as { models: unknown[] }).models;
	}
	if (Array.isArray((payload as { items?: unknown[] }).items)) {
		return (payload as { items: unknown[] }).items;
	}
	return [];
}

function parseModelId(candidate: unknown): string | null {
	if (!candidate || typeof candidate !== "object") return null;
	const value = candidate as {
		id?: unknown;
		model?: unknown;
		name?: unknown;
	};
	return normalizeModelId(
		normalizeModelId(value.id) ??
			normalizeModelId(value.model) ??
			normalizeModelId(value.name),
	);
}

function isZeroish(value: unknown): boolean {
	if (typeof value === "number") return value <= 0;
	if (typeof value !== "string") return false;
	const parsed = Number(value.replace(/[,$\s]/g, ""));
	return Number.isFinite(parsed) && parsed <= 0;
}

function isOpenRouterFree(candidate: Record<string, unknown>): boolean {
	const pricing = candidate.pricing;
	if (!pricing || typeof pricing !== "object") return false;
	const cost: Record<string, unknown> = pricing as Record<string, unknown>;
	const promptCost = isZeroish(cost.prompt) || isZeroish(cost.prompt_cache_hit);
	const completionCost = isZeroish(cost.completion);
	const requestCost = isZeroish(cost.request);

	return promptCost || completionCost || requestCost;
}

function modelDescription(
	candidate: unknown,
	options: ProviderModelOptions,
	modelId: string,
): string {
	if (!candidate || typeof candidate !== "object") return modelId;
	const parsed = candidate as Record<string, unknown>;
	if (options.parseDescription) {
		return options.parseDescription(parsed, modelId);
	}
	return parseDescriptionFromObject(parsed);
}

function modelLabel(
	candidate: unknown,
	options: ProviderModelOptions,
	modelId: string,
): string {
	if (!candidate || typeof candidate !== "object") return modelId;
	if (options.parseLabel) {
		const value = options.parseLabel(candidate);
		if (value) return value;
	}
	const candidateObject = candidate as Record<string, unknown>;
	if (typeof candidateObject.name === "string" && candidateObject.name.trim()) {
		return candidateObject.name.trim();
	}
	return modelId;
}

function dedupeModels(candidates: ModelOption[]): ModelOption[] {
	const seen = new Set<string>();
	const next: ModelOption[] = [];
	for (const item of candidates) {
		const id = item.id.toLowerCase();
		if (seen.has(id)) continue;
		seen.add(id);
		next.push(item);
	}
	return next.sort((left, right) =>
		left.label.localeCompare(right.label, undefined, { sensitivity: "base" }),
	);
}

function normalizeCandidateModel(
	candidate: unknown,
	options: ProviderModelOptions,
): ModelOption | null {
	if (!candidate || typeof candidate !== "object") return null;
	const modelId = parseModelId(candidate);
	if (!modelId) return null;
	if (
		options.includeOnlyFreeModels &&
		!isOpenRouterFree(candidate as Record<string, unknown>)
	) {
		return null;
	}

	return {
		id: modelId,
		label: modelLabel(candidate, options, modelId),
		description: modelDescription(candidate, options, modelId),
	};
}

const MODELS_BY_PROVIDER_TIMEOUT_MS = 90_000;
const MODEL_LIST_CACHE = new Map<
	string,
	{ expiresAt: number; models: ModelOption[] }
>();

const MODEL_ENDPOINT_ORIGINS = new Set([
	"https://api.openai.com",
	"https://api.anthropic.com",
	"https://api.moonshot.cn",
	"https://api.minimax.chat",
	"https://api.deepseek.com",
	"https://openrouter.ai",
]);

function getSafeModelsUrl(modelsUrl: string): string {
	let url: URL;
	try {
		url = new URL(modelsUrl);
	} catch {
		throw new Error("Unsupported provider models endpoint");
	}

	if (!MODEL_ENDPOINT_ORIGINS.has(url.origin)) {
		throw new Error("Unsupported provider models endpoint");
	}

	return url.toString();
}

function cacheKey(
	providerId: SupportedProvider,
	credential: string,
	includeFreeOnly: boolean,
): string {
	const hash = createHash("sha256").update(credential).digest("hex");
	return `${providerId}:${includeFreeOnly ? "free" : "all"}:${hash}`;
}

function getCachedModels(
	providerId: SupportedProvider,
	credential: string,
	includeFreeOnly: boolean,
): ModelOption[] | null {
	const entry = MODEL_LIST_CACHE.get(
		cacheKey(providerId, credential, includeFreeOnly),
	);
	if (!entry || entry.expiresAt <= now()) return null;
	return entry.models;
}

function setCachedModels(
	providerId: SupportedProvider,
	credential: string,
	includeFreeOnly: boolean,
	models: ModelOption[],
) {
	MODEL_LIST_CACHE.set(cacheKey(providerId, credential, includeFreeOnly), {
		models,
		expiresAt: now() + MODELS_BY_PROVIDER_TIMEOUT_MS,
	});
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
		id: "chatgpt",
		label: "ChatGPT",
		authMode: "oauth",
		createModel: ({ apiKey, model }) =>
			createOpenAI({ apiKey, baseURL: "https://api.openai.com/v1" })(model),
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
		},
	},
	{
		id: "kimi",
		label: "Kimi",
		authMode: "api_key",
		createModel: ({ apiKey, model }) =>
			createOpenAI({ apiKey, baseURL: "https://api.moonshot.cn/v1" })(model),
		modelOptions: {
			modelsUrl: "https://api.moonshot.cn/v1/models",
			includeOnlyFreeModels: false,
		},
	},
	{
		id: "minimax",
		label: "Minimax",
		authMode: "api_key",
		createModel: ({ apiKey, model }) =>
			createOpenAI({ apiKey, baseURL: "https://api.minimax.chat/v1" })(model),
		modelOptions: {
			modelsUrl: "https://api.minimax.chat/v1/models",
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
	const definition = PROVIDERS.find((candidate) => candidate.id === provider);
	if (!definition) {
		throw new Error(`Unsupported provider: ${provider}`);
	}
	return definition;
}

async function fetchModelsFromProvider(
	provider: ProviderCatalogDefinition,
	credential: string,
): Promise<ModelOption[]> {
	const key = fromSecret(credential);
	if (!key) {
		return [];
	}

	const cached = getCachedModels(
		provider.id,
		key,
		provider.modelOptions.includeOnlyFreeModels,
	);
	if (cached) return cached;

	const headers = {
		Authorization: `Bearer ${key}`,
		"Content-Type": "application/json",
		...provider.modelOptions.requestHeaders,
	};
	const modelsUrl = getSafeModelsUrl(provider.modelOptions.modelsUrl);
	const response = await fetch(modelsUrl, {
		headers,
		method: "GET",
		cache: "no-store",
		signal: AbortSignal.timeout(10_000),
	} as RequestInit);

	if (!response.ok) {
		throw new Error(`Failed to load models for ${provider.label}`);
	}

	const payload = await response.json().catch(() => null);
	const rawModels = extractModelList(payload);
	const parsed = rawModels
		.map((candidate) =>
			normalizeCandidateModel(candidate, provider.modelOptions),
		)
		.filter((item): item is ModelOption => item !== null);
	const models = dedupeModels(parsed);
	setCachedModels(
		provider.id,
		key,
		provider.modelOptions.includeOnlyFreeModels,
		models,
	);
	return models;
}

export async function listProviderOptions(input?: {
	providerSecrets?: Partial<Record<string, string>>;
}): Promise<ProviderOption[]> {
	return Promise.all(
		PROVIDERS.map(async (provider) => {
			const secret = input?.providerSecrets?.[provider.id];
			let models: ModelOption[] = [];

			if (secret) {
				try {
					models = await fetchModelsFromProvider(provider, secret);
				} catch {
					models = [];
				}
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
	const normalizedProvider = input.provider.toLowerCase().trim();
	const definition = getProviderConfig(normalizedProvider);
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
	const definition = getProviderConfig(provider);
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

export function randomOAuthState(length = 32): string {
	return randomBytes(length).toString("base64url");
}

export function sha256Base64Url(value: string): string {
	return createHash("sha256").update(value).digest("base64url");
}
