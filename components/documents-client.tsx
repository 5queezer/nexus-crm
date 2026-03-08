"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import Link from "next/link";

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

function CopyShareLink({ docId }: { docId: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    const res = await fetch("/api/config/public-token");
    const { token } = await res.json();
    const url = `${window.location.origin}/api/documents/${docId}/file?token=${token}`;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      onClick={handleCopy}
      title="Share-Link kopieren"
      className="text-gray-400 hover:text-gray-700 text-sm font-medium transition-colors"
    >
      {copied ? "✅" : "🔗"}
    </button>
  );
}

export function DocumentsClient({ user }: DocumentsClientProps) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

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
      setUploadError(err instanceof Error ? err.message : "Upload fehlgeschlagen");
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
    if (confirm(`Dokument „${name}" wirklich löschen?`)) {
      deleteMutation.mutate(id);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <Link href="/" className="text-gray-400 hover:text-gray-600 transition-colors">
                ← Zurück
              </Link>
              <span className="text-gray-200">|</span>
              <span className="text-2xl">📁</span>
              <h1 className="text-xl font-bold text-gray-900">Dokumente</h1>
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
              <span className="text-sm text-gray-600 hidden sm:block">
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
              ? "border-blue-400 bg-blue-50"
              : "border-gray-300 bg-white hover:border-blue-400 hover:bg-blue-50/30"
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
          <p className="text-gray-700 font-medium">
            {uploading
              ? "Wird hochgeladen…"
              : "Datei hierher ziehen oder klicken zum Auswählen"}
          </p>
          <p className="text-gray-400 text-sm mt-1">
            PDF, JPEG, PNG · Max. 10 MB pro Datei
          </p>
          {uploadError && (
            <p className="mt-3 text-sm text-red-600 font-medium">⚠ {uploadError}</p>
          )}
        </div>

        {/* Document list */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="text-lg font-semibold text-gray-900">
              Hochgeladene Dokumente ({documents.length})
            </h2>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : documents.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <div className="text-4xl mb-3">📭</div>
              <p>Noch keine Dokumente hochgeladen.</p>
            </div>
          ) : (
            <ul className="divide-y divide-gray-50">
              {documents.map((doc) => (
                <li
                  key={doc.id}
                  className="flex items-center gap-4 px-6 py-4 hover:bg-gray-50/60 transition-colors"
                >
                  <span className="text-2xl flex-shrink-0">{fileIcon(doc.mimeType)}</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 truncate">{doc.originalName}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {formatBytes(doc.size)} ·{" "}
                      {format(new Date(doc.uploadedAt), "dd.MM.yyyy HH:mm", { locale: de })}
                    </p>
                    {doc.applications.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {doc.applications.map((a) => (
                          <span
                            key={a.id}
                            className="inline-flex items-center px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 text-xs"
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
                      Download
                    </a>
                    <CopyShareLink docId={doc.id} />
                    <button
                      onClick={() => handleDelete(doc.id, doc.originalName)}
                      className="text-red-500 hover:text-red-700 text-sm font-medium transition-colors"
                    >
                      Löschen
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">
          Dokumente sind nur für dich sichtbar (Login erforderlich).
        </p>
      </main>
    </div>
  );
}
