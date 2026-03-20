"use client";

import { useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";

interface OnboardingWizardProps {
  onComplete: () => void;
}

const STEPS = ["welcome", "profile", "first_app", "done"] as const;
type Step = (typeof STEPS)[number];

export function OnboardingWizard({ onComplete }: OnboardingWizardProps) {
  const t = useTranslations("onboarding");
  const [currentStep, setCurrentStep] = useState<Step>("welcome");
  const [appTitle, setAppTitle] = useState("");
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");
  const [error, setError] = useState("");
  const queryClient = useQueryClient();

  const stepIndex = STEPS.indexOf(currentStep);

  function handleSkip() {
    localStorage.setItem("onboarding-complete", "true");
    onComplete();
  }

  function nextStep() {
    const next = STEPS[stepIndex + 1];
    if (next) setCurrentStep(next);
  }

  const handleSaveProfile = useCallback(() => {
    if (appTitle.trim()) {
      const settings = JSON.parse(localStorage.getItem("appSettings") || "{}");
      settings.appTitle = appTitle.trim();
      localStorage.setItem("appSettings", JSON.stringify(settings));
      document.title = appTitle.trim();
    }
    nextStep();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appTitle]);

  async function handleCreateApp() {
    if (!company.trim() || !role.trim()) {
      setError(t("required_fields"));
      return;
    }
    setError("");
    try {
      const res = await fetch("/api/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company: company.trim(),
          role: role.trim(),
          status: "inbound",
        }),
      });
      if (!res.ok) throw new Error("Failed");
      queryClient.invalidateQueries({ queryKey: ["applications"] });
      nextStep();
    } catch {
      setError(t("error_create"));
    }
  }

  function handleFinish() {
    localStorage.setItem("onboarding-complete", "true");
    onComplete();
  }

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* Progress dots */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {STEPS.map((step, i) => (
            <div
              key={step}
              className={`h-2 rounded-full transition-all ${
                i === stepIndex
                  ? "w-8 bg-blue-600"
                  : i < stepIndex
                  ? "w-2 bg-blue-400"
                  : "w-2 bg-gray-200 dark:bg-gray-700"
              }`}
            />
          ))}
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-lg p-8">
          {currentStep === "welcome" && (
            <div className="text-center space-y-4">
              <div className="text-4xl">👋</div>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                {t("welcome_title")}
              </h2>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {t("welcome_description")}
              </p>
              <button
                onClick={nextStep}
                className="w-full mt-4 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
              >
                {t("get_started")}
              </button>
            </div>
          )}

          {currentStep === "profile" && (
            <div className="space-y-4">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">
                {t("profile_title")}
              </h2>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {t("profile_description")}
              </p>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t("app_title_label")}
                </label>
                <input
                  type="text"
                  value={appTitle}
                  onChange={(e) => setAppTitle(e.target.value)}
                  placeholder={t("app_title_placeholder")}
                  className="w-full rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleSaveProfile}
                  className="flex-1 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
                >
                  {t("continue")}
                </button>
              </div>
            </div>
          )}

          {currentStep === "first_app" && (
            <div className="space-y-4">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">
                {t("first_app_title")}
              </h2>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {t("first_app_description")}
              </p>
              {error && (
                <div className="p-2 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-sm text-red-600 dark:text-red-400">
                  {error}
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t("company_label")} *
                </label>
                <input
                  type="text"
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  placeholder={t("company_placeholder")}
                  className="w-full rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t("role_label")} *
                </label>
                <input
                  type="text"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  placeholder={t("role_placeholder")}
                  className="w-full rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    // Skip creating an app
                    nextStep();
                  }}
                  className="rounded-lg border border-gray-200 dark:border-gray-600 px-4 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  {t("skip_step")}
                </button>
                <button
                  onClick={handleCreateApp}
                  className="flex-1 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
                >
                  {t("create_app")}
                </button>
              </div>
            </div>
          )}

          {currentStep === "done" && (
            <div className="text-center space-y-4">
              <div className="text-4xl">🎉</div>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                {t("done_title")}
              </h2>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {t("done_description")}
              </p>
              <div className="space-y-2 text-left bg-gray-50 dark:bg-gray-900/50 rounded-lg p-4">
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">{t("tips_title")}</p>
                <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1.5">
                  <li>• <kbd className="px-1 py-0.5 text-xs bg-gray-200 dark:bg-gray-700 rounded">{typeof navigator !== "undefined" && /Mac/.test(navigator.userAgent) ? "⌘" : "Ctrl+"}K</kbd> {t("tip_search")}</li>
                  <li>• <kbd className="px-1 py-0.5 text-xs bg-gray-200 dark:bg-gray-700 rounded">N</kbd> {t("tip_new")}</li>
                  <li>• <kbd className="px-1 py-0.5 text-xs bg-gray-200 dark:bg-gray-700 rounded">?</kbd> {t("tip_shortcuts")}</li>
                </ul>
              </div>
              <button
                onClick={handleFinish}
                className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
              >
                {t("go_to_dashboard")}
              </button>
            </div>
          )}
        </div>

        {/* Skip link */}
        {currentStep !== "done" && (
          <div className="text-center mt-4">
            <button
              onClick={handleSkip}
              className="text-sm text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            >
              {t("skip_setup")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
