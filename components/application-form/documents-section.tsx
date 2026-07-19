"use client";

import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { CollapsibleCard, SectionCard } from "./section-card";

function docFileIcon(mimeType: string): string {
  if (mimeType === "application/pdf") return "📄";
  if (mimeType.startsWith("image/")) return "🖼️";
  return "📎";
}

function docFormatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

interface AppDocument {
  id: string;
  filename: string;
  originalName: string;
  size: number;
  mimeType: string;
  uploadedAt: string;
}

function DocShareButton({
  docId,
  docName,
}: {
  docId: string;
  docName: string;
}) {
  const t = useTranslations("modal");
  const [copied, setCopied] = useState(false);

  async function handleShare() {
    const res = await fetch("/api/share-links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetType: "document", targetId: docId }),
    });
    if (!res.ok) return;
    const { code } = await res.json();
    const url = `${window.location.origin}/s/${code}`;

    if (navigator.share) {
      try {
        await navigator.share({ title: docName, url });
        return;
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
      }
    }

    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = url;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      type="button"
      onClick={handleShare}
      title={t("documents_share_hint")}
      className="text-sm text-slate-400 transition-colors hover:text-slate-700 dark:hover:text-slate-200"
    >
      {copied ? "✅" : "🔗"}
    </button>
  );
}

export function DocumentsSection({
  applicationId,
  resumeId,
  variant = "collapsible",
}: {
  applicationId: string;
  resumeId: string | null;
  variant?: "collapsible" | "open";
}) {
  const t = useTranslations("modal");
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const { data: documents = [], isLoading } = useQuery<AppDocument[]>({
    queryKey: ["application-documents", applicationId],
    queryFn: async () => {
      const res = await fetch(`/api/applications/${applicationId}/documents`);
      if (!res.ok) throw new Error("Failed to fetch documents");
      return res.json();
    },
  });
  const documentCount = documents.length + (resumeId ? 1 : 0);

  async function handleUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploadError(null);
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("applicationIds", JSON.stringify([applicationId]));
        const res = await fetch("/api/documents", {
          method: "POST",
          body: formData,
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `Upload failed (${res.status})`);
        }
      }
      queryClient.invalidateQueries({
        queryKey: ["application-documents", applicationId],
      });
      queryClient.invalidateQueries({ queryKey: ["documents"] });
    } catch (err) {
      setUploadError(
        err instanceof Error ? err.message : t("documents_upload_error"),
      );
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleUnlink(docId: string) {
    try {
      const res = await fetch(
        `/api/applications/${applicationId}/documents/${docId}`,
        {
          method: "DELETE",
        },
      );
      if (!res.ok) throw new Error();
      queryClient.invalidateQueries({
        queryKey: ["application-documents", applicationId],
      });
      queryClient.invalidateQueries({ queryKey: ["documents"] });
    } catch {
      setUploadError(t("documents_error"));
    }
  }

  const body = (
    <div className="space-y-2">
      {uploadError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700 dark:border-red-800/50 dark:bg-red-950/50 dark:text-red-400">
          {uploadError}
        </div>
      )}
      {isLoading ? (
        <div className="flex justify-center py-4">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
        </div>
      ) : documentCount === 0 ? (
        <p className="py-2 text-center text-sm text-slate-400 dark:text-slate-500">
          {t("documents_empty")}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {resumeId && (
            <li className="flex items-center gap-2 rounded-xl border border-slate-200/80 bg-slate-50/80 px-3 py-2 dark:border-white/8 dark:bg-white/4">
              <span className="shrink-0 text-lg" aria-hidden="true">
                🔗
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-900 dark:text-white">
                  {t("documents_reactive_resume")}
                </p>
                <p className="text-xs text-slate-400 dark:text-slate-500">
                  {t("documents_external_link")}
                </p>
              </div>
              <a
                href={`/api/applications/${applicationId}/resume`}
                target="_blank"
                rel="noopener noreferrer"
                className="nexus-target text-xs font-medium text-indigo-600 transition-colors hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300"
              >
                {t("documents_open_resume")}
              </a>
            </li>
          )}
          {documents.map((doc) => (
            <li
              key={doc.id}
              className="flex items-center gap-2 rounded-xl border border-slate-200/80 bg-slate-50/80 px-3 py-2 dark:border-white/8 dark:bg-white/4"
            >
              <span className="shrink-0 text-lg">{docFileIcon(doc.mimeType)}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-900 dark:text-white">
                  {doc.originalName}
                </p>
                <p className="text-xs text-slate-400 dark:text-slate-500">
                  {docFormatBytes(doc.size)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    const link = document.createElement("a");
                    link.href = `/api/documents/${doc.id}/file`;
                    link.download = doc.originalName;
                    link.click();
                  }}
                  className="nexus-target text-xs font-medium text-indigo-600 transition-colors hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300"
                >
                  {t("documents_download")}
                </button>
                <DocShareButton docId={doc.id} docName={doc.originalName} />
                <button
                  type="button"
                  onClick={() => handleUnlink(doc.id)}
                  className="text-xs font-medium text-red-500 transition-colors hover:text-red-700"
                >
                  {t("documents_unlink")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,image/jpeg,image/png,image/webp"
        multiple
        className="hidden"
        onChange={(e) => handleUpload(e.target.files)}
      />
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading}
        className="w-full rounded-xl border border-dashed border-slate-300 py-2 text-sm text-slate-500 transition-colors hover:border-indigo-400 hover:text-indigo-600 disabled:opacity-50 dark:border-white/15 dark:text-slate-400 dark:hover:border-indigo-400 dark:hover:text-indigo-400"
      >
        {uploading ? t("documents_uploading") : t("documents_add")}
      </button>
    </div>
  );

  if (variant === "open") {
    return (
      <SectionCard title={`📎 ${t("documents_section")}`}>{body}</SectionCard>
    );
  }

  return (
    <CollapsibleCard
      title={`📎 ${t("documents_section")}`}
      badge={
        documentCount > 0 ? (
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-700 dark:bg-indigo-500/25 dark:text-indigo-300">
            {documentCount}
          </span>
        ) : undefined
      }
    >
      {body}
    </CollapsibleCard>
  );
}
