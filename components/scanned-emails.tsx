"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import {
  Inbox,
  Check,
  X,
  ChevronDown,
  ChevronUp,
  Loader2,
  Mail,
} from "lucide-react";

interface ScannedEmail {
  id: string;
  subject: string;
  sender: string;
  receivedAt: string;
  classification: string | null;
  confidence: string;
  extractedData: { company: string | null; role: string | null } | null;
  status: string;
  applicationId: string | null;
}

export function ScannedEmails() {
  const t = useTranslations("email");
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<"pending" | "imported" | "dismissed">(
    "pending"
  );
  const [expanded, setExpanded] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data, isLoading } = useQuery({
    queryKey: ["scanned-emails", filter],
    queryFn: async () => {
      const resp = await fetch(`/api/email/scanned?status=${filter}`);
      const json = await resp.json();
      return json.emails as ScannedEmail[];
    },
  });

  const actionMutation = useMutation({
    mutationFn: async ({
      ids,
      action,
    }: {
      ids: string[];
      action: "import" | "dismiss";
    }) => {
      const resp = await fetch("/api/email/scanned", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, action }),
      });
      if (!resp.ok) throw new Error("Action failed");
      return resp.json();
    },
    onSuccess: () => {
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: ["scanned-emails"] });
      queryClient.invalidateQueries({ queryKey: ["applications"] });
    },
  });

  const emails = data ?? [];
  const pendingCount = emails.length;

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selected.size === emails.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(emails.map((e) => e.id)));
    }
  };

  const classificationBadge = (c: string | null, confidence: string) => {
    const colors: Record<string, string> = {
      applied:
        "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300",
      interview:
        "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300",
      rejection:
        "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300",
      offer:
        "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300",
    };
    const confidenceOpacity =
      confidence === "high" ? "" : confidence === "medium" ? "opacity-80" : "opacity-60";
    return (
      <span
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${colors[c ?? ""] ?? "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400"} ${confidenceOpacity}`}
      >
        {c ? t(`classification.${c}`) : t("classification.unknown")}
      </span>
    );
  };

  return (
    <section className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 space-y-4">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between"
      >
        <div className="flex items-center gap-2">
          <Inbox className="w-5 h-5 text-blue-600" />
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            {t("scanned_title")}
          </h2>
          {filter === "pending" && pendingCount > 0 && (
            <span className="px-2 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full text-xs font-medium">
              {pendingCount}
            </span>
          )}
        </div>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-gray-400" />
        ) : (
          <ChevronDown className="w-4 h-4 text-gray-400" />
        )}
      </button>

      {expanded && (
        <>
          {/* Filter tabs */}
          <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700">
            {(["pending", "imported", "dismissed"] as const).map((s) => (
              <button
                key={s}
                onClick={() => {
                  setFilter(s);
                  setSelected(new Set());
                }}
                className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                  filter === s
                    ? "border-blue-600 text-blue-600 dark:text-blue-400"
                    : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                }`}
              >
                {t(`filter.${s}`)}
              </button>
            ))}
          </div>

          {isLoading ? (
            <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 py-4">
              <Loader2 className="w-4 h-4 animate-spin" />
              {t("loading")}
            </div>
          ) : emails.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-gray-400 dark:text-gray-500">
              <Mail className="w-8 h-8" />
              <p className="text-sm">{t("no_emails")}</p>
            </div>
          ) : (
            <>
              {/* Bulk actions */}
              {filter === "pending" && (
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                    <input
                      type="checkbox"
                      checked={
                        selected.size === emails.length && emails.length > 0
                      }
                      onChange={selectAll}
                      className="w-4 h-4 rounded text-blue-600"
                    />
                    {t("select_all")}
                  </label>
                  {selected.size > 0 && (
                    <div className="flex gap-2">
                      <button
                        onClick={() =>
                          actionMutation.mutate({
                            ids: Array.from(selected),
                            action: "import",
                          })
                        }
                        disabled={actionMutation.isPending}
                        className="inline-flex items-center gap-1 text-xs px-3 py-1.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded-md hover:bg-green-200 transition-colors disabled:opacity-50"
                      >
                        <Check className="w-3 h-3" />
                        {t("import_selected", { count: selected.size })}
                      </button>
                      <button
                        onClick={() =>
                          actionMutation.mutate({
                            ids: Array.from(selected),
                            action: "dismiss",
                          })
                        }
                        disabled={actionMutation.isPending}
                        className="inline-flex items-center gap-1 text-xs px-3 py-1.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors disabled:opacity-50"
                      >
                        <X className="w-3 h-3" />
                        {t("dismiss_selected")}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Email list */}
              <div className="space-y-2">
                {emails.map((email) => (
                  <div
                    key={email.id}
                    className="flex items-start gap-3 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg"
                  >
                    {filter === "pending" && (
                      <input
                        type="checkbox"
                        checked={selected.has(email.id)}
                        onChange={() => toggleSelect(email.id)}
                        className="mt-1 w-4 h-4 rounded text-blue-600"
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        {classificationBadge(
                          email.classification,
                          email.confidence
                        )}
                        {email.extractedData?.company && (
                          <span className="text-sm font-medium text-gray-900 dark:text-white">
                            {email.extractedData.company}
                          </span>
                        )}
                        {email.extractedData?.role && (
                          <span className="text-sm text-gray-500 dark:text-gray-400">
                            — {email.extractedData.role}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-600 dark:text-gray-300 truncate mt-1">
                        {email.subject}
                      </p>
                      <div className="flex items-center gap-2 mt-1 text-xs text-gray-400 dark:text-gray-500">
                        <span>{email.sender.replace(/<[^>]+>/, "").trim()}</span>
                        <span>·</span>
                        <span>
                          {new Date(email.receivedAt).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                    {filter === "pending" && (
                      <div className="flex gap-1 shrink-0">
                        <button
                          onClick={() =>
                            actionMutation.mutate({
                              ids: [email.id],
                              action: "import",
                            })
                          }
                          disabled={actionMutation.isPending}
                          title={t("import")}
                          className="p-1.5 text-green-600 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/30 rounded transition-colors"
                        >
                          <Check className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() =>
                            actionMutation.mutate({
                              ids: [email.id],
                              action: "dismiss",
                            })
                          }
                          disabled={actionMutation.isPending}
                          title={t("dismiss")}
                          className="p-1.5 text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
