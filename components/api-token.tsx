"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Key, Copy, Check } from "lucide-react";

interface TokenInfo {
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
}

async function fetchToken(): Promise<{ token: TokenInfo | null }> {
  const res = await fetch("/api/token");
  if (!res.ok) throw new Error("Failed to fetch token");
  return res.json();
}

async function createToken(): Promise<{ raw: string; token: TokenInfo }> {
  const res = await fetch("/api/token", { method: "POST" });
  if (!res.ok) throw new Error("Failed to create token");
  return res.json();
}

async function deleteToken(): Promise<void> {
  const res = await fetch("/api/token", { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to revoke token");
}

export function ApiToken() {
  const t = useTranslations("token");
  const queryClient = useQueryClient();
  const [newRawToken, setNewRawToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ["api-token"],
    queryFn: fetchToken,
  });

  const generateMutation = useMutation({
    mutationFn: createToken,
    onSuccess: (result) => {
      setNewRawToken(result.raw);
      setCopied(false);
      queryClient.invalidateQueries({ queryKey: ["api-token"] });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: deleteToken,
    onSuccess: () => {
      setNewRawToken(null);
      queryClient.invalidateQueries({ queryKey: ["api-token"] });
    },
  });

  const existingToken = data?.token;
  const isPending = generateMutation.isPending || revokeMutation.isPending;

  function handleGenerate() {
    if (existingToken && !confirm(t("confirm_regenerate"))) return;
    generateMutation.reset();
    revokeMutation.reset();
    generateMutation.mutate();
  }

  function handleRevoke() {
    if (!confirm(t("confirm_revoke"))) return;
    setNewRawToken(null);
    generateMutation.reset();
    revokeMutation.reset();
    revokeMutation.mutate();
  }

  async function handleCopy() {
    if (!newRawToken) return;
    await navigator.clipboard.writeText(newRawToken);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (isLoading) return <div className="py-4 text-sm text-gray-500">{t("loading")}</div>;

  if (isError) {
    return (
      <div className="space-y-3 py-4">
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {t("load_error")}
        </p>
        <button
          type="button"
          onClick={() => void refetch()}
          disabled={isFetching}
          className="min-h-11 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800"
        >
          {t("retry")}
        </button>
      </div>
    );
  }

  return (
    <section className="space-y-4">
      <div>
        <h3 className="flex items-center gap-2 font-semibold text-gray-900 dark:text-white">
          <Key className="h-4 w-4 text-indigo-600" />
          {t("title")}
        </h3>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{t("description")}</p>
      </div>

      <div className="space-y-3">
        {(generateMutation.isError || revokeMutation.isError) && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {t("action_failed")}
          </p>
        )}
        {/* Show newly generated token (once) */}
        {newRawToken && (
          <div className="rounded-lg border border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-3 space-y-2">
            <p className="text-xs font-medium text-amber-800 dark:text-amber-300">{t("show_once_warning")}</p>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <code className="min-w-0 flex-1 select-all break-all rounded border border-gray-200 bg-white p-2 text-xs text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100">
                {newRawToken}
              </code>
              <button
                type="button"
                onClick={handleCopy}
                aria-label={t("copy")}
                className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg border border-gray-200 px-3 py-2 transition-colors hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-gray-700 dark:hover:bg-gray-700"
                title={t("copy")}
              >
                {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4 text-gray-500" />}
              </button>
            </div>
          </div>
        )}

        {/* Token status */}
        {existingToken && !newRawToken && (
          <div className="text-xs text-gray-500 dark:text-gray-400 space-y-1">
            <div>{t("created")}: {new Date(existingToken.createdAt).toLocaleDateString()}</div>
            <div>{t("last_used")}: {existingToken.lastUsedAt ? new Date(existingToken.lastUsedAt).toLocaleDateString() : t("never_used")}</div>
          </div>
        )}

        {!existingToken && !newRawToken && (
          <p className="text-xs text-gray-500 dark:text-gray-400">{t("no_token")}</p>
        )}

        {/* Actions */}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleGenerate}
            disabled={isPending}
            className="min-h-11 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:opacity-50 dark:ring-offset-gray-900"
          >
            {t("generate")}
          </button>
          {existingToken && (
            <button
              type="button"
              onClick={handleRevoke}
              disabled={isPending}
              className="min-h-11 rounded-lg border border-red-200 px-4 py-2 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20"
            >
              {t("revoke")}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
