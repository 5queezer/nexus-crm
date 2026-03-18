"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { format } from "date-fns";
import { de, enUS } from "date-fns/locale";
import Link from "next/link";
import { useTranslations, useLocale } from "next-intl";

interface ApplicationRef {
  id: string;
  company: string;
  role: string;
}

interface Document {
  id: string;
  filename: string;
  originalName: string;
  size: number;
  mimeType: string;
  uploadedAt: string;
  applications: ApplicationRef[];
}

interface DocumentsClientProps {
  user: {
    name?: string | null;
    email: string;
    image?: string | null;
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function fileIcon(mimeType: string): string {
  if (mimeType === "application/pdf") return "📄";
  if (mimeType.startsWith("image/")) return "🖼️";
  return "📎";
}

async function fetchDocuments(): Promise<Document[]> {
  const res = await fetch("/api/documents");
  if (!res.ok) throw new Error("Failed to fetch documents");
  return res.json();
}

async function deleteDocument(id: string): Promise<void> {
  const res = await fetch(`/api/documents/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete document");
}

async function renameDocument({ id, originalName }: { id: string; originalName: string }): Promise<Document> {
  const res = await fetch(`/api/documents/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ originalName }),
  });
  if (!res.ok) throw new Error("Failed to rename document");
  return res.json();
}

function copyToClipboard(text: string) {
  try {
    navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  }
}

function CopyShareLink({ docId, docName }: { docId: string; docName: string }) {
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

    copyToClipboard(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const t = useTranslations("documents_page");
  return (
    <button
      onClick={handleShare}
      title={t("share_hint")}
      className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-sm font-medium transition-colors"
    >
      {copied ? "✅" : "🔗"}
    </button>
  );
}

function InlineRename({ doc, onDone }: { doc: Document; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState(doc.originalName);
  const inputRef = useRef<HTMLInputElement>(null);

  const mutation = useMutation({
    mutationFn: renameDocument,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      onDone();
    },
  });

  function submit() {
    const trimmed = value.trim();
    if (trimmed && trimmed !== doc.originalName) {
      mutation.mutate({ id: doc.id, originalName: trimmed });
    } else {
      onDone();
    }
  }

  return (
    <input
      ref={inputRef}
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={submit}
      onKeyDown={(e) => {
        if (e.key === "Enter") submit();
        if (e.key === "Escape") onDone();
      }}
      className="font-medium text-gray-900 dark:text-white bg-transparent border border-blue-400 rounded px-1 py-0.5 outline-none w-full max-w-md"
    />
  );
}

export function DocumentsClient({ user }: DocumentsClientProps) {
  const queryClient = useQueryClient();
  const t = useTranslations("documents_page");
  const locale = useLocale();
  const dateFnsLocale = locale === "de" ? de : enUS;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);

  const { data: documents = [], isLoading } = useQuery({
    queryKey: ["documents"],
    queryFn: fetchDocuments,
  });

  const deleteMutation = useMutation({
    mutationFn: deleteDocument,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["documents"] }),
  });

  async function handleUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploadError(null);
    setUploading(true);

    try {
      for (const file of Array.from(files)) {
        const formData = new FormData();
        formData.append("file", file);

        const res = await fetch("/api/documents", {
          method: "POST",
          body: formData,
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `Upload failed (${res.status})`);
        }
      }
      queryClient.invalidateQueries({ queryKey: ["documents"] });
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    handleUpload(e.dataTransfer.files);
  }

  function handleDelete(id: string, name: string) {
    if (confirm(t("confirm_delete", { name }))) {
      deleteMutation.mutate(id);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <Link href="/" className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors">
                ← {t("back")}
              </Link>
              <span className="text-gray-200 dark:text-gray-600">|</span>
              <span className="text-2xl">📁</span>
              <h1 className="text-xl font-bold text-gray-900 dark:text-white">{t("title")}</h1>
            </div>
            <div className="flex items-center gap-3">
              {user.image && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={user.image}
                  alt={user.name || user.email}
                  className="w-8 h-8 rounded-full"
                />
              )}
              <span className="text-sm text-gray-600 dark:text-gray-300 hidden sm:block">
                {user.name || user.email}
              </span>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Upload zone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`cursor-pointer border-2 border-dashed rounded-xl p-10 text-center transition-colors mb-8 ${
            dragOver
              ? "border-blue-400 bg-blue-50 dark:bg-blue-950/30"
              : "border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 hover:border-blue-400 hover:bg-blue-50/30 dark:hover:bg-blue-950/20"
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,image/jpeg,image/png,image/webp"
            multiple
            className="hidden"
            onChange={(e) => handleUpload(e.target.files)}
          />
          <div className="text-4xl mb-3">{uploading ? "⏳" : "📤"}</div>
          <p className="text-gray-700 dark:text-gray-200 font-medium">
            {uploading
              ? t("uploading")
              : t("drop_hint")}
          </p>
          <p className="text-gray-400 dark:text-gray-500 text-sm mt-1">
            {t("file_types")}
          </p>
          {uploadError && (
            <p className="mt-3 text-sm text-red-600 font-medium">⚠ {uploadError}</p>
          )}
        </div>

        {/* Document list */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              {t("uploaded_files", { count: documents.length })}
            </h2>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : documents.length === 0 ? (
            <div className="text-center py-16 text-gray-400 dark:text-gray-500">
              <div className="text-4xl mb-3">📭</div>
              <p>{t("no_files")}</p>
            </div>
          ) : (
            <ul className="divide-y divide-gray-50 dark:divide-gray-700/50">
              {documents.map((doc) => (
                <li
                  key={doc.id}
                  className="flex items-center gap-4 px-6 py-4 hover:bg-gray-50/60 dark:hover:bg-gray-700/50 transition-colors"
                >
                  <span className="text-2xl flex-shrink-0">{fileIcon(doc.mimeType)}</span>
                  <div className="flex-1 min-w-0">
                    {renamingId === doc.id ? (
                      <InlineRename doc={doc} onDone={() => setRenamingId(null)} />
                    ) : (
                      <p
                        className="font-medium text-gray-900 dark:text-white truncate cursor-pointer"
                        onDoubleClick={() => setRenamingId(doc.id)}
                        title={t("rename_hint")}
                      >
                        {doc.originalName}
                      </p>
                    )}
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                      {formatBytes(doc.size)} ·{" "}
                      {format(new Date(doc.uploadedAt), "dd.MM.yyyy HH:mm", { locale: dateFnsLocale })}
                    </p>
                    {doc.applications.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {doc.applications.map((a) => (
                          <span
                            key={a.id}
                            className="inline-flex items-center px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 text-xs"
                          >
                            {a.company} – {a.role}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <a
                      href={`/api/documents/${doc.id}/file`}
                      download={doc.originalName}
                      className="text-blue-600 hover:text-blue-800 text-sm font-medium transition-colors"
                    >
                      {t("download")}
                    </a>
                    <button
                      onClick={() => setRenamingId(doc.id)}
                      title="Rename"
                      className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-sm font-medium transition-colors"
                    >
                      ✏️
                    </button>
                    <CopyShareLink docId={doc.id} docName={doc.originalName} />
                    <button
                      onClick={() => handleDelete(doc.id, doc.originalName)}
                      className="text-red-500 hover:text-red-700 text-sm font-medium transition-colors"
                    >
                      {t("delete")}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <p className="text-center text-xs text-gray-400 dark:text-gray-500 mt-6">
          {t("footer")}
        </p>
      </main>
    </div>
  );
}
