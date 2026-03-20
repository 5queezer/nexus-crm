"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import {
  analyzeResume,
  type AnalysisResult,
  type SkillCategory,
  type ExtractedKeyword,
} from "@/lib/resume-analysis";

interface ApplicationOption {
  id: string;
  company: string;
  role: string;
  jobDescription: string | null;
}

interface CvDocument {
  id: string;
  originalName: string;
}

interface CvViewerProps {
  applications: ApplicationOption[];
  initialApplicationId?: string;
}

export function CvViewer({ applications, initialApplicationId }: CvViewerProps) {
  const t = useTranslations("resume_review");
  const tn = useTranslations("cv_viewer");
  const router = useRouter();
  const searchParams = useSearchParams();

  const [selectedAppId, setSelectedAppId] = useState(
    initialApplicationId || searchParams.get("applicationId") || ""
  );
  const [cvDoc, setCvDoc] = useState<CvDocument | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [activeTab, setActiveTab] = useState<"keywords" | "tips">("keywords");
  const [categoryFilter, setCategoryFilter] = useState<SkillCategory | "all">("all");

  const selectedApp = useMemo(
    () => applications.find((a) => a.id === selectedAppId),
    [applications, selectedAppId]
  );

  // Fetch CV document for selected application via patch
  const fetchCvDoc = useCallback(async (appId: string) => {
    setLoading(true);
    setError(null);
    setCvDoc(null);
    setResult(null);
    try {
      const res = await fetch(`/api/cv/patch?applicationId=${appId}`);
      if (!res.ok) {
        setCvDoc(null);
        return;
      }
      const patch = await res.json();
      if (patch.documentId) {
        const docRes = await fetch(`/api/documents/${patch.documentId}`);
        if (docRes.ok) {
          const doc = await docRes.json();
          setCvDoc({ id: doc.id, originalName: doc.originalName });
        }
      }
    } catch {
      setError("Failed to load CV data");
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-run keyword analysis when CV doc exists
  const runAnalysis = useCallback(async (appId: string, jobDescription: string) => {
    try {
      const res = await fetch(`/api/cv/text?applicationId=${appId}`);
      if (!res.ok) return;
      const { text } = await res.json();
      if (text && jobDescription) {
        const analysis = analyzeResume(text, jobDescription);
        setResult(analysis);
      }
    } catch {
      // Analysis is best-effort
    }
  }, []);

  useEffect(() => {
    if (selectedAppId) {
      fetchCvDoc(selectedAppId);
    }
  }, [selectedAppId, fetchCvDoc]);

  useEffect(() => {
    if (cvDoc && selectedApp?.jobDescription) {
      runAnalysis(selectedAppId, selectedApp.jobDescription);
    }
  }, [cvDoc, selectedApp, selectedAppId, runAnalysis]);

  function handleAppChange(appId: string) {
    setSelectedAppId(appId);
    router.replace(`/resume-review?applicationId=${appId}`, { scroll: false });
  }

  async function handleGenerate() {
    if (!selectedAppId) return;
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/cv/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applicationId: selectedAppId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Generation failed");
      }
      // Refresh to show new CV
      await fetchCvDoc(selectedAppId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  }

  const scoreColor = useMemo(() => {
    if (!result) return "";
    if (result.matchScore >= 75) return "text-green-600 dark:text-green-400";
    if (result.matchScore >= 50) return "text-yellow-600 dark:text-yellow-400";
    return "text-red-600 dark:text-red-400";
  }, [result]);

  const scoreBarColor = useMemo(() => {
    if (!result) return "";
    if (result.matchScore >= 75) return "bg-green-500";
    if (result.matchScore >= 50) return "bg-yellow-500";
    return "bg-red-500";
  }, [result]);

  const filteredKeywords = useMemo(() => {
    if (!result) return [];
    if (categoryFilter === "all") return result.keywords;
    return result.keywords.filter((k) => k.category === categoryFilter);
  }, [result, categoryFilter]);

  const categoryLabel = (cat: SkillCategory): string => {
    const labels: Record<SkillCategory, string> = {
      technical: t("cat_technical"),
      soft: t("cat_soft"),
      qualification: t("cat_qualification"),
      other: t("cat_other"),
    };
    return labels[cat];
  };

  return (
    <div className="space-y-6">
      {/* Application selector */}
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-end">
        <div className="flex-1 min-w-0">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            {tn("select_application")}
          </label>
          <select
            value={selectedAppId}
            onChange={(e) => handleAppChange(e.target.value)}
            className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-4 py-2.5 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">{tn("select_placeholder")}</option>
            {applications.map((app) => (
              <option key={app.id} value={app.id}>
                {app.company} — {app.role}
              </option>
            ))}
          </select>
        </div>
        {selectedAppId && (
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="shrink-0 flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {generating ? tn("generating") : cvDoc ? tn("regenerate") : tn("generate")}
          </button>
        )}
      </div>

      {error && (
        <div className="p-4 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/50 rounded-xl text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {/* No application selected */}
      {!selectedAppId && (
        <div className="text-center py-20 text-gray-400 dark:text-gray-500">
          {tn("no_selection")}
        </div>
      )}

      {/* Loading */}
      {loading && selectedAppId && (
        <div className="text-center py-12 text-gray-400 dark:text-gray-500">
          {tn("loading")}
        </div>
      )}

      {/* No CV yet */}
      {selectedAppId && !loading && !cvDoc && (
        <div className="text-center py-16">
          <p className="text-gray-500 dark:text-gray-400 mb-4">{tn("no_cv")}</p>
          <p className="text-sm text-gray-400 dark:text-gray-500">{tn("no_cv_hint")}</p>
        </div>
      )}

      {/* CV exists — two-column layout */}
      {selectedAppId && !loading && cvDoc && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {/* Left: PDF preview */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {cvDoc.originalName}
              </span>
              <a
                href={`/api/documents/${cvDoc.id}/file`}
                download
                className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
              >
                {tn("download")}
              </a>
            </div>
            <iframe
              src={`/api/documents/${cvDoc.id}/file`}
              className="w-full h-[700px] bg-gray-100 dark:bg-gray-900"
              title="CV Preview"
            />
          </div>

          {/* Right: Gap analysis */}
          <div className="space-y-6">
            {!selectedApp?.jobDescription && (
              <div className="p-4 bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-800/50 rounded-xl text-sm text-yellow-700 dark:text-yellow-300">
                {tn("no_jd")}
              </div>
            )}

            {result && (
              <>
                {/* Score overview */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
                    <h3 className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
                      {t("match_score")}
                    </h3>
                    <span className={`text-3xl font-bold ${scoreColor}`}>
                      {result.matchScore}%
                    </span>
                    <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 mt-2 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${scoreBarColor}`}
                        style={{ width: `${result.matchScore}%` }}
                      />
                    </div>
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      {result.matchedCount} {t("matched")} · {result.missingCount} {t("missing")}
                    </p>
                  </div>

                  <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
                    <h3 className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
                      {t("word_count")}
                    </h3>
                    <span className="text-3xl font-bold text-gray-900 dark:text-white">
                      {result.wordCount}
                    </span>
                  </div>

                  <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
                    <h3 className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
                      {t("keywords_found")}
                    </h3>
                    <span className="text-3xl font-bold text-gray-900 dark:text-white">
                      {result.keywords.length}
                    </span>
                  </div>
                </div>

                {/* Tabs */}
                <div className="border-b border-gray-200 dark:border-gray-700">
                  <div className="flex gap-1">
                    <button
                      onClick={() => setActiveTab("keywords")}
                      className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                        activeTab === "keywords"
                          ? "border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400"
                          : "border-transparent text-gray-500 dark:text-gray-400"
                      }`}
                    >
                      {t("tab_keywords")} ({result.keywords.length})
                    </button>
                    <button
                      onClick={() => setActiveTab("tips")}
                      className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                        activeTab === "tips"
                          ? "border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400"
                          : "border-transparent text-gray-500 dark:text-gray-400"
                      }`}
                    >
                      {t("tab_tips")} ({result.formattingTips.length})
                    </button>
                  </div>
                </div>

                {activeTab === "keywords" && (
                  <div className="space-y-4">
                    <div className="flex flex-wrap gap-2">
                      <FilterButton
                        active={categoryFilter === "all"}
                        onClick={() => setCategoryFilter("all")}
                        label={t("filter_all")}
                        count={result.keywords.length}
                      />
                      {(["technical", "soft", "qualification", "other"] as SkillCategory[]).map(
                        (cat) => {
                          const count = result.categoryCounts[cat].total;
                          if (count === 0) return null;
                          return (
                            <FilterButton
                              key={cat}
                              active={categoryFilter === cat}
                              onClick={() => setCategoryFilter(cat)}
                              label={categoryLabel(cat)}
                              count={count}
                            />
                          );
                        }
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {filteredKeywords.map((kw) => (
                        <KeywordBadge key={kw.term} keyword={kw} categoryLabel={categoryLabel} />
                      ))}
                    </div>
                    {result.missingCount > 0 && categoryFilter === "all" && (
                      <div className="p-4 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800/50 rounded-xl">
                        <h4 className="text-sm font-medium text-red-800 dark:text-red-300 mb-2">
                          {t("missing_title")} ({result.missingCount})
                        </h4>
                        <div className="flex flex-wrap gap-1.5">
                          {result.keywords
                            .filter((k) => !k.found)
                            .map((kw) => (
                              <span
                                key={kw.term}
                                className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300"
                              >
                                {kw.term}
                              </span>
                            ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {activeTab === "tips" && (
                  <div className="space-y-3">
                    {result.formattingTips.map((tip, i) => (
                      <TipCard key={i} tip={tip} t={t} />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function FilterButton({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
        active
          ? "bg-blue-600 text-white"
          : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
      }`}
    >
      {label}
      <span
        className={`inline-flex items-center justify-center px-1.5 min-w-[1.25rem] h-5 rounded-full text-xs font-bold ${
          active
            ? "bg-white/20 text-white"
            : "bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200"
        }`}
      >
        {count}
      </span>
    </button>
  );
}

function KeywordBadge({
  keyword,
  categoryLabel,
}: {
  keyword: ExtractedKeyword;
  categoryLabel: (cat: SkillCategory) => string;
}) {
  const catColors: Record<SkillCategory, string> = {
    technical: "border-blue-300 dark:border-blue-700",
    soft: "border-purple-300 dark:border-purple-700",
    qualification: "border-amber-300 dark:border-amber-700",
    other: "border-gray-300 dark:border-gray-600",
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border ${
        catColors[keyword.category]
      } ${
        keyword.found
          ? "bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-300"
          : "bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300"
      }`}
      title={`${categoryLabel(keyword.category)} — ${keyword.found ? "Found" : "Missing"}`}
    >
      <span className="text-xs">{keyword.found ? "✓" : "✗"}</span>
      {keyword.term}
    </span>
  );
}

function TipCard({
  tip,
  t,
}: {
  tip: { type: "success" | "warning" | "error"; messageKey: string; messageParams?: Record<string, string | number> };
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  const colors = {
    success: "bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800/50 text-green-800 dark:text-green-300",
    warning: "bg-yellow-50 dark:bg-yellow-950/30 border-yellow-200 dark:border-yellow-800/50 text-yellow-800 dark:text-yellow-300",
    error: "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800/50 text-red-800 dark:text-red-300",
  };

  let message: string;
  try {
    message = tip.messageParams ? t(tip.messageKey, tip.messageParams) : t(tip.messageKey);
  } catch {
    message = tip.messageKey;
  }

  return (
    <div className={`flex items-start gap-3 p-4 rounded-xl border ${colors[tip.type]}`}>
      <p className="text-sm">{message}</p>
    </div>
  );
}
