import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";

export type SupportedProvider = "openai" | "anthropic";

export type ProviderOption = {
  id: SupportedProvider;
  label: string;
  models: Array<{ id: string; label: string; description: string }>;
};

const PROVIDERS: ProviderOption[] = [
  {
    id: "openai",
    label: "OpenAI",
    models: [
      { id: "gpt-5.4-mini", label: "GPT-5.4 mini", description: "Fast daily operator" },
      { id: "gpt-5.4", label: "GPT-5.4", description: "Deep analysis and planning" },
    ],
  },
  {
    id: "anthropic",
    label: "Anthropic",
    models: [
      { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", description: "Balanced reasoning and speed" },
      { id: "claude-opus-4-6", label: "Claude Opus 4.6", description: "Most capable complex-work model" },
      { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", description: "Fast lightweight tasks" },
    ],
  },
];

export function listProviderOptions(): ProviderOption[] {
  return PROVIDERS.map((provider) => ({
    ...provider,
    models: provider.models.map((model) => ({ ...model })),
  }));
}

export function getProviderConfig(provider: string, model: string) {
  const providerConfig = PROVIDERS.find((candidate) => candidate.id === provider);
  if (!providerConfig) throw new Error("Unsupported provider");
  const modelConfig = providerConfig.models.find((candidate) => candidate.id === model);
  if (!modelConfig) throw new Error("Unsupported model");
  return { provider: providerConfig, model: modelConfig };
}

export function createUserLanguageModel(input: {
  provider: string;
  model: string;
  apiKey: string;
}) {
  getProviderConfig(input.provider, input.model);
  if (input.provider === "openai") {
    return createOpenAI({ apiKey: input.apiKey })(input.model);
  }
  return createAnthropic({ apiKey: input.apiKey })(input.model);
}
