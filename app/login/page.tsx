"use client";

import { authClient } from "@/lib/auth-client";
import { safeInternalCallbackURL } from "@/lib/auth/login-callback";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { LanguageSwitcher } from "@/components/language-switcher";
import { ThemeSwitcher } from "@/components/theme-switcher";

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = useTranslations();
  const searchParams = useSearchParams();

  async function handleGoogleLogin() {
    setLoading(true);
    setError(null);
    try {
      // Support redirect back to MCP authorize endpoint after login
      const callbackURL = safeInternalCallbackURL(searchParams.get("callbackURL"));
      await authClient.signIn.social({
        provider: "google",
        callbackURL,
      });
    } catch {
      setError(t("login.error"));
      setLoading(false);
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-50 text-slate-950 dark:bg-[#08090a] dark:text-slate-100">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_12%_18%,rgba(94,106,210,0.18),transparent_28rem),radial-gradient(circle_at_88%_78%,rgba(16,185,129,0.12),transparent_26rem)]" />
      <div
        className="absolute inset-0 opacity-[0.18] dark:opacity-[0.16]"
        style={{
          backgroundImage: "radial-gradient(circle, currentColor 1px, transparent 1px)",
          backgroundSize: "28px 28px",
          color: "rgb(148 163 184)",
        }}
      />

      <div className="absolute right-4 top-4 z-20 flex items-center gap-2">
        <ThemeSwitcher />
        <LanguageSwitcher />
      </div>

      <main className="relative z-10 grid min-h-screen place-items-center px-4 py-16 sm:px-6 lg:px-8">
        <div className="grid w-full max-w-6xl overflow-hidden rounded-4xl border border-slate-200/80 bg-white/80 shadow-2xl shadow-slate-200/70 backdrop-blur-2xl dark:border-white/8 dark:bg-white/[0.035] dark:shadow-black/40 lg:grid-cols-[1.15fr_0.85fr]">
          <section className="relative hidden border-r border-slate-200/80 p-10 dark:border-white/8 lg:block">
            <div className="mb-12 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/70 px-3 py-1 text-xs font-medium text-slate-600 shadow-sm dark:border-white/8 dark:bg-white/4 dark:text-slate-300">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              {t("login.hero_badge")}
            </div>

            <div className="max-w-xl">
              <p className="mb-4 text-sm font-semibold uppercase tracking-[0.22em] text-indigo-600 dark:text-[#828fff]">
                {t("login.hero_eyebrow")}
              </p>
              <h1 className="text-5xl font-semibold leading-[0.98] tracking-[-0.06em] text-slate-950 dark:text-[#f7f8f8]">
                {t("login.hero_title")}
              </h1>
              <p className="mt-5 max-w-lg text-base leading-7 text-slate-600 dark:text-slate-400">
                {t("login.hero_subtitle")}
              </p>
            </div>

            <div className="mt-12 grid max-w-xl gap-3 rounded-2xl border border-slate-200 bg-slate-950 p-3 shadow-2xl shadow-slate-300/50 dark:border-white/8 dark:bg-black/40 dark:shadow-black/40">
              {[
                [t("login.sample_inbound"), t("login.sample_role_1"), t("login.sample_today"), "bg-emerald-400"],
                [t("login.sample_interview"), t("login.sample_role_2"), t("login.sample_thursday"), "bg-indigo-400"],
                [t("login.sample_follow_up"), t("login.sample_role_3"), t("login.sample_overdue"), "bg-amber-400"],
              ].map(([stage, role, date, dot]) => (
                <div key={role} className="flex items-center justify-between rounded-xl border border-white/8 bg-white/4 px-4 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-xs font-medium text-slate-400">
                      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
                      {stage}
                    </div>
                    <div className="mt-1 truncate text-sm font-semibold text-white">{role}</div>
                  </div>
                  <span className="rounded-full border border-white/8 px-2 py-1 text-xs text-slate-300">{date}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="p-8 sm:p-10 lg:p-12">
            <div className="mb-10 flex justify-center lg:justify-start">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-lg shadow-indigo-600/25 dark:bg-[#5e6ad2]">
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
            </div>

            <div className="text-center lg:text-left">
              <h2 className="text-3xl font-semibold tracking-[-0.04em] text-slate-950 dark:text-[#f7f8f8] sm:text-4xl">
                {t("login.headline")}
              </h2>
              <p className="mt-3 text-sm leading-6 text-slate-500 dark:text-slate-400">
                {t("login.subtitle")}
              </p>
            </div>

            {error && (
              <div className="mt-8 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">
                {error}
              </div>
            )}

            <button
              onClick={handleGoogleLogin}
              disabled={loading}
              className="mt-8 flex min-h-[52px] w-full items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-white px-6 py-3 text-sm font-semibold text-slate-800 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/8 dark:bg-white/6 dark:text-slate-100 dark:hover:bg-white/9"
            >
              {loading ? (
                <div className="h-5 w-5 rounded-full border-2 border-slate-400 border-t-transparent animate-spin" />
              ) : (
                <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                </svg>
              )}
              {t("login.button")}
            </button>

            <p className="mt-6 text-center text-xs leading-5 text-slate-400 dark:text-slate-500 lg:text-left">
              {t.rich("legal.login_agree", {
                terms: (chunks) => (
                  <Link href="/legal#terms" className="underline underline-offset-4 transition hover:text-slate-600 dark:hover:text-slate-300">
                    {chunks}
                  </Link>
                ),
                privacy: (chunks) => (
                  <Link href="/legal#privacy" className="underline underline-offset-4 transition hover:text-slate-600 dark:hover:text-slate-300">
                    {chunks}
                  </Link>
                ),
              })}
            </p>

            <a
              href="https://github.com/5queezer/nexus-crm"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-8 inline-flex items-center gap-2 text-xs font-medium text-slate-400 transition hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300"
            >
              <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
              </svg>
              5queezer/nexus-crm
            </a>
          </section>
        </div>
      </main>
    </div>
  );
}
