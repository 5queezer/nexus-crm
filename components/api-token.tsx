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

  const { data, isLoading } = useQuery({
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
    generateMutation.mutate();
  }

  function handleRevoke() {
    if (!confirm(t("confirm_revoke"))) return;
    setNewRawToken(null);
    revokeMutation.mutate();
  }

  async function handleCopy() {
    if (!newRawToken) return;
    await navigator.clipboard.writeText(newRawToken);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (isLoading) return <div className="p-4 text-sm text-gray-500">{t("loading")}</div>;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div className="p-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-900/20">
        <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
          <Key className="w-4 h-4 text-blue-600" />
          {t("title")}
        </h3>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{t("description")}</p>
      </div>

      <div className="p-4 space-y-3">
        {/* Show newly generated token (once) */}
        {newRawToken && (
          <div className="rounded-lg border border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-3 space-y-2">
            <p className="text-xs font-medium text-amber-800 dark:text-amber-300">{t("show_once_warning")}</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs bg-white dark:bg-gray-900 p-2 rounded border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100 break-all select-all">
                {newRawToken}
              </code>
              <button
                onClick={handleCopy}
                className="shrink-0 p-2 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
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
        <div className="flex gap-2">
          <button
            onClick={handleGenerate}
            disabled={isPending}
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {t("generate")}
          </button>
          {existingToken && (
            <button
              onClick={handleRevoke}
              disabled={isPending}
              className="px-3 py-1.5 text-xs font-medium rounded-lg border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50 transition-colors"
            >
              {t("revoke")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
