"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { Bot, Check, Copy, Info } from "lucide-react";

function subscribeToOrigin(callback: () => void) {
  const id = window.setTimeout(callback, 0);
  return () => window.clearTimeout(id);
}

function getBrowserOrigin() {
  return window.location.origin;
}

function getServerOrigin() {
  return null;
}

function useBrowserOrigin() {
  return useSyncExternalStore(subscribeToOrigin, getBrowserOrigin, getServerOrigin);
}

function copyWithTextareaFallback(value: string) {
  const ta = document.createElement("textarea");
  ta.value = value;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();

  try {
    return document.execCommand("copy");
  } finally {
    document.body.removeChild(ta);
  }
}

function CodeBlock({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    let didCopy = false;

    try {
      await navigator.clipboard.writeText(value);
      didCopy = true;
    } catch {
      didCopy = copyWithTextareaFallback(value);
    }

    if (didCopy) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-gray-950 dark:border-gray-700">
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
        <span className="text-xs font-medium text-gray-300">{label}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex min-h-11 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-gray-300 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto whitespace-pre-wrap break-all p-3 text-xs leading-5 text-gray-100">
        <code>{value}</code>
      </pre>
    </div>
  );
}

export function McpClientHelp() {
  const origin = useBrowserOrigin();

  const mcpUrl = origin ? `${origin}/api/mcp` : "";
  const oauthMetadataUrl = origin ? `${origin}/.well-known/oauth-authorization-server` : "";
  const protectedResourceUrl = origin ? `${origin}/.well-known/oauth-protected-resource` : "";

  const headerBasedConfig = useMemo(
    () =>
      JSON.stringify(
        {
          url: mcpUrl,
          headers: {
            Authorization: "Bearer jt_<your-token>",
          },
        },
        null,
        2
      ),
    [mcpUrl]
  );

  return (
    <section className="space-y-5">
      <div>
        <h3 className="flex items-center gap-2 font-semibold text-gray-900 dark:text-white">
          <Bot className="h-4 w-4 text-indigo-600" />
          MCP client setup
        </h3>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          Connect Claude or ChatGPT to Nexus CRM so the assistant can list, create, update, and attach documents to your opportunities.
        </p>
      </div>

      <div className="space-y-5 text-sm text-gray-700 dark:text-gray-300">
        <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-xs text-blue-900 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-200">
          <div className="flex gap-2">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              Recommended: use OAuth in Claude.ai, Claude Desktop custom connectors, or ChatGPT. Create a static token in{" "}
              <a href="/settings#api" className="font-semibold underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
                API access
              </a>{" "}
              only for clients that explicitly support Authorization headers.
            </p>
          </div>
        </div>

        {origin ? (
          <CodeBlock value={mcpUrl} label="MCP server URL" />
        ) : (
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-500 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-400">
            Loading setup URLs…
          </div>
        )}

        <div className="divide-y divide-gray-200 border-y border-gray-200 dark:divide-gray-700 dark:border-gray-700">
          <details>
            <summary className="min-h-11 cursor-pointer py-3 font-semibold text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-white">
              OAuth connector setup
            </summary>
            <div className="pb-4">
              <ol className="list-decimal space-y-1 pl-5 text-xs text-gray-600 dark:text-gray-400">
                <li>Open the connector or MCP server settings in Claude or ChatGPT.</li>
                <li>Add a custom connector named <strong>Nexus CRM</strong>.</li>
                <li>Paste the MCP server URL shown above.</li>
                <li>Choose OAuth if prompted, then sign in and approve the connection.</li>
              </ol>
              {origin && (
                <>
                  <div className="mt-3">
                    <CodeBlock value={oauthMetadataUrl} label="OAuth discovery URL" />
                  </div>
                  <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                    If a client asks for protected-resource metadata, use{" "}
                    <code className="break-all rounded bg-gray-100 px-1 py-0.5 dark:bg-gray-900">{protectedResourceUrl}</code>.
                  </p>
                </>
              )}
            </div>
          </details>

          <details>
            <summary className="min-h-11 cursor-pointer py-3 font-semibold text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-white">
              API-token fallback
            </summary>
            <div className="pb-4">
              <ol className="list-decimal space-y-1 pl-5 text-xs text-gray-600 dark:text-gray-400">
                <li>Generate an API token in API access and copy it immediately.</li>
                <li>Use this only in clients that support custom HTTP headers for remote MCP servers.</li>
                <li>Do not paste this into Claude Desktop&apos;s local server config; remote MCP should use a custom connector with OAuth.</li>
              </ol>
              {origin && (
                <div className="mt-3">
                  <CodeBlock value={headerBasedConfig} label="Generic header-based remote MCP config" />
                </div>
              )}
            </div>
          </details>
        </div>
      </div>
    </section>
  );
}
