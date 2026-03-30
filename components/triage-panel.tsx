"use client";

import { useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import {
  CompanySize,
  IncomingSource,
  TriageScore,
  COMPANY_SIZE_OPTIONS,
  INCOMING_SOURCE_OPTIONS,
  TRIAGE_COLORS,
} from "@/types";

type TriAnswer = "yes" | "no" | "unclear";

interface TriageAnswers {
  specificReasons: TriAnswer;
  remoteFirst: TriAnswer;
  companySizeSmall: TriAnswer;
  salaryMentioned: TriAnswer;
  roleFit: TriAnswer;
}

interface TriageFormData {
  companySize: CompanySize | "";
  salaryBandMentioned: boolean;
  triageQuality: TriageScore | null;
  triageReason: string;
  incomingSource: IncomingSource | "";
  autoRejected: boolean;
  autoRejectReason: string;
}

interface TriagePanelProps {
  data: TriageFormData;
  onChange: (data: Partial<TriageFormData>) => void;
  jobDescription?: string;
}

function computeScore(answers: TriageAnswers): TriageScore {
  let score = 0;
  if (answers.specificReasons === "yes") score += 2;
  else if (answers.specificReasons === "unclear") score += 0.5;
  if (answers.remoteFirst === "yes") score += 2;
  else if (answers.remoteFirst === "unclear") score += 0.5;
  if (answers.companySizeSmall === "yes") score += 1.5;
  else if (answers.companySizeSmall === "unclear") score += 0.5;
  if (answers.salaryMentioned === "yes") score += 2;
  if (answers.roleFit === "yes") score += 2.5;
  else if (answers.roleFit === "unclear") score += 1;

  // Map 0-10 to 1-5
  if (score >= 8) return 5;
  if (score >= 6) return 4;
  if (score >= 4) return 3;
  if (score >= 2) return 2;
  return 1;
}

function checkAutoReject(
  companySize: CompanySize | "",
  jobDescription: string
): { rejected: boolean; reason: string } {
  const reasons: string[] = [];
  const jdLower = jobDescription.toLowerCase();

  if (companySize === "large" || companySize === "enterprise") {
    reasons.push("Company size > 5k");
  }
  if (
    jdLower.includes("java") &&
    !jdLower.includes("javascript") &&
    !jdLower.includes("typescript")
  ) {
    reasons.push("Java-primary role");
  }
  if (
    jdLower.includes("defense") ||
    jdLower.includes("defence") ||
    jdLower.includes("government") ||
    jdLower.includes("military")
  ) {
    reasons.push("Defense/Govt sector");
  }
  if (
    (jdLower.includes("qa ") ||
      jdLower.includes("quality assurance") ||
      jdLower.includes("sdet") ||
      jdLower.includes("test engineer")) &&
    !jdLower.includes("backend") &&
    !jdLower.includes("platform")
  ) {
    reasons.push("Pure QA/SDET role");
  }
  if (
    (jdLower.includes("consultancy") ||
      jdLower.includes("consulting") ||
      jdLower.includes("professional services") ||
      jdLower.includes("bodyshop") ||
      jdLower.includes("body shop") ||
      jdLower.includes("staffing")) &&
    !jdLower.includes("remote")
  ) {
    reasons.push("Consultancy without remote guarantee");
  }

  return {
    rejected: reasons.length > 0,
    reason: reasons.join("; "),
  };
}

const triAnswerBtn =
  "px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors";
const triAnswerActive =
  "bg-blue-600 text-white border-blue-600";
const triAnswerInactive =
  "bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600";

export function TriagePanel({ data, onChange, jobDescription = "" }: TriagePanelProps) {
  const t = useTranslations("modal");

  const [answers, setAnswers] = useState<TriageAnswers>({
    specificReasons: "unclear",
    remoteFirst: "unclear",
    companySizeSmall: "unclear",
    salaryMentioned: data.salaryBandMentioned ? "yes" : "unclear",
    roleFit: "unclear",
  });

  const [suggestedScore, setSuggestedScore] = useState<TriageScore | null>(null);

  const updateAnswer = useCallback(
    (key: keyof TriageAnswers, value: TriAnswer) => {
      const next = { ...answers, [key]: value };
      setAnswers(next);
      const score = computeScore(next);
      setSuggestedScore(score);

      // Auto-update salaryBandMentioned
      if (key === "salaryMentioned") {
        onChange({ salaryBandMentioned: value === "yes" });
      }
    },
    [answers, onChange]
  );

  const applySuggestion = useCallback(() => {
    if (suggestedScore === null) return;
    onChange({ triageQuality: suggestedScore });

    // Check auto-reject
    const { rejected, reason } = checkAutoReject(data.companySize || "", jobDescription);
    if (rejected && suggestedScore <= 2) {
      onChange({
        triageQuality: 1,
        autoRejected: true,
        autoRejectReason: reason,
      });
    }
  }, [suggestedScore, data.companySize, jobDescription, onChange]);

  const scoreLabel = (score: number) =>
    t(`triage_score_${score}` as "triage_score_1");

  const questions: { key: keyof TriageAnswers; label: string; options: TriAnswer[] }[] = [
    { key: "specificReasons", label: t("triage_q_specific"), options: ["yes", "no", "unclear"] },
    { key: "remoteFirst", label: t("triage_q_remote"), options: ["yes", "no", "unclear"] },
    { key: "companySizeSmall", label: t("triage_q_company_size"), options: ["yes", "no", "unclear"] },
    { key: "salaryMentioned", label: t("triage_q_salary"), options: ["yes", "no"] },
    { key: "roleFit", label: t("triage_q_role_fit"), options: ["yes", "no", "unclear"] },
  ];

  const answerLabel = (a: TriAnswer) => {
    if (a === "yes") return t("triage_yes");
    if (a === "no") return t("triage_no");
    return t("triage_unclear");
  };

  return (
    <div className="space-y-4">
      {/* Guided Questions */}
      <div className="space-y-3">
        {questions.map((q) => (
          <div key={q.key}>
            <p className="text-sm text-gray-700 dark:text-gray-300 mb-1.5">{q.label}</p>
            <div className="flex gap-2">
              {q.options.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => updateAnswer(q.key, opt)}
                  className={`${triAnswerBtn} ${
                    answers[q.key] === opt ? triAnswerActive : triAnswerInactive
                  }`}
                >
                  {answerLabel(opt)}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Suggested Score */}
      {suggestedScore !== null && (
        <div className="flex items-center gap-3 p-3 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800/50">
          <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
            {t("triage_suggest")}:
          </span>
          <span
            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold ${TRIAGE_COLORS[suggestedScore]}`}
          >
            {suggestedScore}/5 — {scoreLabel(suggestedScore)}
          </span>
          <button
            type="button"
            onClick={applySuggestion}
            className="ml-auto px-3 py-1 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
          >
            {t("triage_apply_suggestion")}
          </button>
        </div>
      )}

      {/* Manual Score Selection */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          {t("triage_quality")}
        </label>
        <div className="flex gap-2">
          {([5, 4, 3, 2, 1] as TriageScore[]).map((score) => (
            <button
              key={score}
              type="button"
              onClick={() => onChange({ triageQuality: data.triageQuality === score ? null : score })}
              className={`flex-1 px-2 py-2 text-xs font-bold rounded-lg border transition-colors ${
                data.triageQuality === score
                  ? TRIAGE_COLORS[score] + " border-transparent ring-2 ring-blue-500"
                  : "bg-white dark:bg-gray-700 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600"
              }`}
            >
              {score}/5
            </button>
          ))}
        </div>
        {data.triageQuality && (
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {scoreLabel(data.triageQuality)}
          </p>
        )}
      </div>

      {/* Triage Reason */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          {t("triage_reason")}
        </label>
        <textarea
          value={data.triageReason}
          onChange={(e) => onChange({ triageReason: e.target.value })}
          rows={2}
          className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
          placeholder={t("triage_reason_placeholder")}
        />
      </div>

      {/* Company Size & Incoming Source */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            {t("company_size")}
          </label>
          <select
            value={data.companySize}
            onChange={(e) => {
              const val = e.target.value as CompanySize | "";
              onChange({ companySize: val || "" });
              // Check auto-reject when company size changes
              if (val === "large" || val === "enterprise") {
                const { rejected, reason } = checkAutoReject(val, jobDescription);
                if (rejected) {
                  onChange({
                    companySize: val,
                    autoRejected: true,
                    autoRejectReason: reason,
                  });
                }
              }
            }}
            className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="">—</option>
            {COMPANY_SIZE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            {t("incoming_source")}
          </label>
          <select
            value={data.incomingSource}
            onChange={(e) => onChange({ incomingSource: (e.target.value as IncomingSource) || "" })}
            className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="">—</option>
            {INCOMING_SOURCE_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Salary Band Mentioned */}
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={data.salaryBandMentioned}
          onChange={(e) => onChange({ salaryBandMentioned: e.target.checked })}
          className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500 dark:bg-gray-700"
        />
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {t("salary_band_mentioned")}
        </span>
      </label>

      {/* Auto-reject indicator */}
      {data.autoRejected && (
        <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/50">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-red-700 dark:text-red-400">
              {t("auto_rejected")}
            </span>
            <button
              type="button"
              onClick={() => onChange({ autoRejected: false, autoRejectReason: "" })}
              className="ml-auto text-xs text-red-600 dark:text-red-400 underline hover:no-underline"
            >
              Override
            </button>
          </div>
          {data.autoRejectReason && (
            <p className="mt-1 text-xs text-red-600 dark:text-red-400">
              {data.autoRejectReason}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
