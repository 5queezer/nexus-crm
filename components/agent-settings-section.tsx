"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { OperatorSettings } from "./ai-operator/operator-settings";
import { apiJson, type Credential, type ProviderOption } from "./ai-operator/types";

export function AgentSettingsSection({ section }: { section: "models" | "connectors" }) {
  const t = useTranslations("ai_operator");
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["agent-credentials"],
    queryFn: () => apiJson<{ providers: ProviderOption[]; credentials: Credential[] }>("/api/agent/credentials"),
  });

  if (query.isLoading) return <div className="flex justify-center py-12"><Loader2 aria-label={t("loading_configuration")} className="h-5 w-5 animate-spin text-indigo-500" /></div>;
  if (query.isError || !query.data) return <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">{t("configuration_load_error")} <button type="button" className="font-semibold underline" onClick={() => void query.refetch()}>{t("retry")}</button></div>;

  const updateCredentials = (updater: (credentials: Credential[]) => Credential[]) => {
    queryClient.setQueryData<{ providers: ProviderOption[]; credentials: Credential[] }>(["agent-credentials"], (current) => current ? { ...current, credentials: updater(current.credentials) } : current);
  };

  return <OperatorSettings
    embedded
    initialTab={section}
    providers={query.data.providers}
    credentials={query.data.credentials}
    onCredentialUpsert={(credential) => updateCredentials((current) => [...current.filter((item) => item.provider !== credential.provider), credential])}
    onCredentialRemove={(provider) => updateCredentials((current) => current.filter((item) => item.provider !== provider))}
  />;
}
