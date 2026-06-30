"use client";

import { useState, useCallback, useMemo } from "react";
import { useTranslations } from "next-intl";
import {
  analyzeResume,
  type AnalysisResult,
  type SkillCategory,
} from "@/lib/resume-analysis";

interface ResumeAnalyzerProps {
  initialJobDescription?: string;
  applicationId?: string;
}

export function ResumeAnalyzer({
  initialJobDescription,
  applicationId,
}: ResumeAnalyzerProps) {
  const t = useTranslations("resume_review");

  const [resumeText, setResumeText] = useState("");
  const [jobDescription, setJobDescription] = useState(initialJobDescription || "");
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [activeTab, setActiveTab] = useState<"keywords" | "tips">("keywords");
  const [categoryFilter, setCategoryFilter] = useState<SkillCategory | "all">("all");

  const handleAnalyze = useCallback(() => {
    if (!resumeText.trim() || !jobDescription.trim()) return;
    const analysis = analyzeResume(resumeText, jobDescription);
    setResult(analysis);
  }, [resumeText, jobDescription]);

  const handleClear = useCallback(() => {
    setResumeText("");
    setJobDescription(initialJobDescription || "");
    setResult(null);
  }, [initialJobDescription]);

  const filteredKeywords = useMemo(() => {
    if (!result) return [];
    if (categoryFilter === "all") return result.keywords;
    return result.keywords.filter((k) => k.category === categoryFilter);
  }, [result, categoryFilter]);

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

  const categoryLabel = (cat: SkillCategory): string => {
    const labels: Record<SkillCategory, string> = {
      technical: t("cat_technical"),
      soft: t("cat_soft"),
      qualification: t("cat_qualification"),
      other: t("cat_other"),
    };
    return labels[cat];
  };

  const canAnalyze = resumeText.trim().length > 0 && jobDescription.trim().length > 0;

  return (
    <div className="space-y-6">
      {/* Privacy notice */}
      <div className="flex items-start gap-3 p-4 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800/50 rounded-xl">
        <span className="text-lg shrink-0">🔒</span>
        <div>
          <p className="text-sm font-medium text-green-800 dark:text-green-300">
            {t("privacy_title")}
          </p>
          <p className="text-xs text-green-600 dark:text-green-400 mt-0.5">
            {t("privacy_description")}
          </p>
        </div>
      </div>

      {/* Input areas */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Resume input */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            📄 {t("resume_label")}
          </label>
          <textarea
            value={resumeText}
            onChange={(e) => setResumeText(e.target.value)}
            rows={14}
            className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-4 py-3 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-y font-mono"
            placeholder={t("resume_placeholder")}
          />
          {resumeText && (
            <p className="mt-1 text-xs text-gray-400">
              {resumeText.trim().split(/\s+/).filter(Boolean).length} {t("words")}
            </p>
          )}
        </div>

        {/* Job description input */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            💼 {t("jd_label")}
            {applicationId && initialJobDescription && (
              <span className="ml-2 text-xs text-blue-500 dark:text-blue-400">
                ({t("jd_loaded")})
              </span>
            )}
          </label>
          <textarea
            value={jobDescription}
            onChange={(e) => setJobDescription(e.target.value)}
            rows={14}
            className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-4 py-3 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-y font-mono"
            placeholder={t("jd_placeholder")}
          />
          {jobDescription && (
            <p className="mt-1 text-xs text-gray-400">
              {jobDescription.trim().split(/\s+/).filter(Boolean).length} {t("words")}
            </p>
          )}
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex flex-col sm:flex-row gap-3">
        <button
          onClick={handleAnalyze}
          disabled={!canAnalyze}
          className="flex-1 sm:flex-none flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <span>🔍</span>
          {t("analyze_button")}
        </button>
        {(resumeText || jobDescription) && (
          <button
            onClick={handleClear}
            className="flex items-center justify-center gap-2 rounded-xl border border-gray-200 dark:border-gray-600 px-4 py-3 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            {t("clear_button")}
          </button>
        )}
      </div>

      {/* Results */}
      {result && (
        <div className="space-y-6">
          {/* Score overview */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            {/* Match score */}
            <div className="col-span-1 sm:col-span-2 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
              <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-3">
                {t("match_score")}
              </h3>
              <div className="flex items-end gap-3 mb-3">
                <span className={`text-5xl font-bold ${scoreColor}`}>
                  {result.matchScore}%
                </span>
              </div>
              <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${scoreBarColor}`}
                  style={{ width: `${result.matchScore}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                {result.matchedCount} {t("matched")} · {result.missingCount} {t("missing")}
              </p>
            </div>

            {/* Word count & read time */}
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
              <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-3">
                {t("word_count")}
              </h3>
              <span className="text-3xl font-bold text-gray-900 dark:text-white">
                {result.wordCount}
              </span>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                ~{result.estimatedReadTimeMinutes} {t("min_read")}
              </p>
            </div>

            {/* Keywords found */}
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
              <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-3">
                {t("keywords_found")}
              </h3>
              <span className="text-3xl font-bold text-gray-900 dark:text-white">
                {result.keywords.length}
              </span>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {t("unique_terms")}
              </p>
            </div>
          </div>

          {/* Category breakdown */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-4">
              {t("category_breakdown")}
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {(["technical", "soft", "qualification", "other"] as SkillCategory[]).map(
                (cat) => {
                  const { total, matched } = result.categoryCounts[cat];
                  if (total === 0) return null;
                  const pct = Math.round((matched / total) * 100);
                  return (
                    <div
                      key={cat}
                      className="text-center p-3 rounded-lg bg-gray-50 dark:bg-gray-900/50"
                    >
                      <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                        {categoryLabel(cat)}
                      </div>
                      <div className="text-lg font-bold text-gray-900 dark:text-white">
                        {matched}/{total}
                      </div>
                      <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5 mt-2 overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            pct >= 75
                              ? "bg-green-500"
                              : pct >= 50
                              ? "bg-yellow-500"
                              : "bg-red-500"
                          }`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                }
              )}
            </div>
          </div>

          {/* Tabs */}
          <div className="border-b border-gray-200 dark:border-gray-700">
            <div className="flex gap-1">
              <button
                onClick={() => setActiveTab("keywords")}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === "keywords"
                    ? "border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400"
                    : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                }`}
              >
                🔑 {t("tab_keywords")} ({result.keywords.length})
              </button>
              <button
                onClick={() => setActiveTab("tips")}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === "tips"
                    ? "border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400"
                    : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                }`}
              >
                💡 {t("tab_tips")} ({result.formattingTips.length})
              </button>
            </div>
          </div>

          {/* Tab content */}
          {activeTab === "keywords" && (
            <div className="space-y-4">
              {/* Category filter */}
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

              {/* Keywords grid */}
              <div className="flex flex-wrap gap-2">
                {filteredKeywords.map((kw) => (
                  <KeywordBadge key={kw.term} keyword={kw} categoryLabel={categoryLabel} />
                ))}
              </div>

              {filteredKeywords.length === 0 && (
                <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-8">
                  {t("no_keywords")}
                </p>
              )}

              {/* Missing keywords summary */}
              {result.missingCount > 0 && categoryFilter === "all" && (
                <div className="mt-4 p-4 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800/50 rounded-xl">
                  <h4 className="text-sm font-medium text-red-800 dark:text-red-300 mb-2">
                    ⚠ {t("missing_title")} ({result.missingCount})
                  </h4>
                  <p className="text-xs text-red-600 dark:text-red-400 mb-3">
                    {t("missing_description")}
                  </p>
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
  keyword: AnalysisResult["keywords"][number];
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
      title={`${categoryLabel(keyword.category)} — ${keyword.found ? "✓ Found" : "✗ Missing"}`}
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
  const icon = tip.type === "success" ? "✅" : tip.type === "warning" ? "⚠️" : "❌";
  const colors = {
    success: "bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800/50 text-green-800 dark:text-green-300",
    warning: "bg-yellow-50 dark:bg-yellow-950/30 border-yellow-200 dark:border-yellow-800/50 text-yellow-800 dark:text-yellow-300",
    error: "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800/50 text-red-800 dark:text-red-300",
  };

  // Try to use translated message, fall back to key
  let message: string;
  try {
    message = tip.messageParams ? t(tip.messageKey, tip.messageParams) : t(tip.messageKey);
  } catch {
    message = tip.messageKey;
  }

  return (
    <div className={`flex items-start gap-3 p-4 rounded-xl border ${colors[tip.type]}`}>
      <span className="text-base shrink-0">{icon}</span>
      <p className="text-sm">{message}</p>
    </div>
  );
}
