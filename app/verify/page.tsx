"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useCallback, Suspense } from "react";

declare global {
  interface Window {
    turnstile?: {
      render: (
        el: string | HTMLElement,
        opts: {
          sitekey: string;
          callback: (token: string) => void;
          "error-callback"?: () => void;
          "expired-callback"?: () => void;
          theme?: "light" | "dark" | "auto";
        },
      ) => string;
      reset: (widgetId: string) => void;
    };
    onloadTurnstileCallback?: () => void;
  }
}

function VerifyInner() {
  const params = useSearchParams();
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "verifying" | "error">("loading");

  const next = params.get("next") ?? "/";

  const handleToken = useCallback(
    async (token: string) => {
      setStatus("verifying");
      try {
        const res = await fetch("/api/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        if (res.ok) {
          router.replace(next);
        } else {
          setStatus("error");
        }
      } catch {
        setStatus("error");
      }
    },
    [next, router],
  );

  useEffect(() => {
    const sitekey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    if (!sitekey) {
      // Turnstile not configured — skip challenge
      router.replace(next);
      return;
    }

    function renderWidget() {
      if (!window.turnstile || !containerRef.current) return;
      if (widgetRef.current) return; // already rendered
      widgetRef.current = window.turnstile.render(containerRef.current, {
        sitekey,
        callback: handleToken,
        "error-callback": () => setStatus("error"),
        "expired-callback": () => setStatus("ready"),
        theme: "auto",
      });
      setStatus("ready");
    }

    if (window.turnstile) {
      renderWidget();
    } else {
      window.onloadTurnstileCallback = renderWidget;
      const script = document.createElement("script");
      script.src =
        "https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onloadTurnstileCallback";
      script.async = true;
      document.head.appendChild(script);
    }
  }, [handleToken, next, router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 px-4">
      <div className="max-w-sm w-full bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-8 text-center">
        <h1 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
          Security Check
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
          Please complete the challenge to continue.
        </p>

        <div ref={containerRef} className="flex justify-center mb-4" />

        {status === "loading" && (
          <p className="text-xs text-gray-400">Loading challenge&hellip;</p>
        )}
        {status === "verifying" && (
          <p className="text-xs text-gray-400">Verifying&hellip;</p>
        )}
        {status === "error" && (
          <p className="text-xs text-red-500">
            Verification failed.{" "}
            <button
              className="underline hover:text-red-600"
              onClick={() => {
                if (widgetRef.current && window.turnstile) {
                  window.turnstile.reset(widgetRef.current);
                }
                setStatus("ready");
              }}
            >
              Try again
            </button>
          </p>
        )}
      </div>
    </div>
  );
}

export default function VerifyPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
          <p className="text-sm text-gray-400">Loading&hellip;</p>
        </div>
      }
    >
      <VerifyInner />
    </Suspense>
  );
}
