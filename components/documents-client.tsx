"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { de, enUS } from "date-fns/locale";
import { ExternalLink, FileImage, FileText, Link2, Loader2, LockKeyhole, Pencil, Search, Share2, Trash2, Upload, X } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppHeader } from "./app-header";

interface ApplicationRef { id: string; company: string; role: string }
interface DocumentRecord {
  id: string; filename: string; originalName: string; size: number; mimeType: string;
  documentType?: string; state?: string; version?: number; submissionId?: string | null;
  uploadedAt: string; applications?: ApplicationRef[];
}
interface ShareLinkRecord { id: string; code: string; targetType: string; targetId: string | null }
interface DocumentsClientProps { user: { name?: string | null; email: string; image?: string | null } }
type DocumentKind = "resume" | "cover_letter" | "other";
type DocumentFilter = "all" | DocumentKind | "unlinked";

const MAX_UPLOAD_SIZE = 10 * 1024 * 1024;
const ALLOWED_UPLOAD_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

async function readJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => null) as ({ error?: string } & T) | null;
  if (!response.ok) throw new Error(body?.error ?? `Request failed (${response.status})`);
  return body as T;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function documentKind(document: DocumentRecord): DocumentKind {
  const type = document.documentType?.toLowerCase().replace(/[ -]/g, "_");
  if (type === "resume" || type === "cv") return "resume";
  if (type === "cover_letter" || type === "coverletter") return "cover_letter";
  const name = document.originalName.toLowerCase();
  if (/\b(resume|cv)\b/.test(name)) return "resume";
  if (/\bcover[\s_-]*letter\b/.test(name)) return "cover_letter";
  return "other";
}

function fileFormat(document: DocumentRecord): string {
  if (document.mimeType === "application/pdf") return "PDF";
  return document.mimeType.split("/")[1]?.toUpperCase() || document.mimeType;
}

async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }
}

export function DocumentsClient({ user }: DocumentsClientProps) {
  const t = useTranslations("documents_page");
  const locale = useLocale();
  const dateLocale = locale === "de" ? de : enUS;
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [filter, setFilter] = useState<DocumentFilter>("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [linkApplicationId, setLinkApplicationId] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  const documentsQuery = useQuery({ queryKey: ["documents"], queryFn: () => readJson<DocumentRecord[]>("/api/documents") });
  const shareLinksQuery = useQuery({ queryKey: ["share-links"], queryFn: () => readJson<{ links: ShareLinkRecord[] }>("/api/share-links") });
  const applicationsQuery = useQuery({ queryKey: ["applications", "document-link-options"], queryFn: () => readJson<ApplicationRef[]>("/api/applications") });

  const documents = useMemo(() => documentsQuery.data ?? [], [documentsQuery.data]);
  const filteredDocuments = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return documents.filter((document) => {
      const applications = document.applications ?? [];
      const matchesFilter = filter === "all" || (filter === "unlinked" ? applications.length === 0 : documentKind(document) === filter);
      const matchesSearch = !normalizedSearch || [document.originalName, ...applications.flatMap((application) => [application.company, application.role])]
        .some((value) => value.toLowerCase().includes(normalizedSearch));
      return matchesFilter && matchesSearch;
    });
  }, [documents, filter, search]);

  useEffect(() => {
    if (!documents.length) { setSelectedId(null); return; }
    if (selectedId && documents.some((document) => document.id === selectedId)) return;
    const hashId = typeof window === "undefined" ? "" : decodeURIComponent(window.location.hash.replace("#document-", ""));
    setSelectedId(documents.find((document) => document.id === hashId)?.id ?? documents[0].id);
  }, [documents, selectedId]);

  const selected = documents.find((document) => document.id === selectedId) ?? null;
  const selectedShareLink = shareLinksQuery.data?.links.find((link) => link.targetType === "document" && link.targetId === selected?.id);
  const selectedApplicationIds = selected?.applications?.map((application) => application.id) ?? [];

  const updateDocumentCache = (document: DocumentRecord) => queryClient.setQueryData<DocumentRecord[]>(["documents"], (current = []) =>
    current.map((item) => item.id === document.id ? document : item));

  const renameMutation = useMutation({
    mutationFn: ({ id, originalName }: { id: string; originalName: string }) => readJson<DocumentRecord>(`/api/documents/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ originalName }),
    }),
    onSuccess: (document) => { updateDocumentCache(document); setRenaming(false); },
    onError: (error) => setActionError(error instanceof Error ? error.message : t("action_failed")),
  });

  const linkMutation = useMutation({
    mutationFn: ({ id, applicationIds }: { id: string; applicationIds: string[] }) => readJson<DocumentRecord>(`/api/documents/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ applicationIds }),
    }),
    onSuccess: (document) => { updateDocumentCache(document); setLinkApplicationId(""); },
    onError: (error) => setActionError(error instanceof Error ? error.message : t("action_failed")),
  });

  const createShareMutation = useMutation({
    mutationFn: (document: DocumentRecord) => readJson<ShareLinkRecord>("/api/share-links", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ targetType: "document", targetId: document.id }),
    }),
    onSuccess: async (link) => {
      queryClient.setQueryData<{ links: ShareLinkRecord[] }>(["share-links"], (current) => ({ links: [...(current?.links.filter((item) => item.id !== link.id) ?? []), link] }));
      await copyText(`${window.location.origin}/s/${link.code}`);
    },
    onError: (error) => setActionError(error instanceof Error ? error.message : t("action_failed")),
  });

  const revokeShareMutation = useMutation({
    mutationFn: (link: ShareLinkRecord) => fetch("/api/share-links", {
      method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: link.id }),
    }).then((response) => { if (!response.ok) throw new Error(t("action_failed")); return link; }),
    onSuccess: (link) => queryClient.setQueryData<{ links: ShareLinkRecord[] }>(["share-links"], (current) => ({ links: current?.links.filter((item) => item.id !== link.id) ?? [] })),
    onError: (error) => setActionError(error instanceof Error ? error.message : t("action_failed")),
  });

  const deleteMutation = useMutation({
    mutationFn: async (document: DocumentRecord) => {
      const response = await fetch(`/api/documents/${document.id}`, { method: "DELETE" });
      if (!response.ok) { const body = await response.json().catch(() => null) as { error?: string } | null; throw new Error(body?.error ?? t("action_failed")); }
      return document.id;
    },
    onSuccess: (id) => queryClient.setQueryData<DocumentRecord[]>(["documents"], (current = []) => current.filter((item) => item.id !== id)),
    onError: (error) => setActionError(error instanceof Error ? error.message : t("action_failed")),
  });

  async function handleUpload(files: FileList | null) {
    if (!files?.length) return;
    const invalid: string[] = [];
    const valid = Array.from(files).filter((file) => {
      if (!ALLOWED_UPLOAD_TYPES.has(file.type)) { invalid.push(t("unsupported_file", { name: file.name })); return false; }
      if (file.size > MAX_UPLOAD_SIZE) { invalid.push(t("oversized_file", { name: file.name })); return false; }
      return true;
    });
    setUploadError(invalid.length ? invalid.join(" ") : null);
    if (!valid.length) return;
    setUploading(true);
    try {
      for (const file of valid) { const formData = new FormData(); formData.append("file", file); await readJson<DocumentRecord>("/api/documents", { method: "POST", body: formData }); }
      await queryClient.invalidateQueries({ queryKey: ["documents"] });
      setFilter("all"); setSearch("");
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : t("upload_failed"));
    } finally {
      setUploading(false); if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function selectDocument(document: DocumentRecord) {
    setSelectedId(document.id); setRenaming(false); setRenameValue(document.originalName); setActionError(null);
  }

  const filters: Array<{ id: DocumentFilter; label: string }> = [
    { id: "all", label: t("filter_all") }, { id: "resume", label: t("filter_resumes") },
    { id: "cover_letter", label: t("filter_cover_letters") }, { id: "other", label: t("filter_other") },
    { id: "unlinked", label: t("filter_unlinked") },
  ];

  return (
    <div className="nexus-shell min-h-screen">
      <AppHeader user={user} />
      <main className="nexus-page-bottom-space mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div><h1 className="text-2xl font-semibold tracking-tight text-slate-950 dark:text-white">{t("title")}</h1><p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t("subtitle")}</p></div>
          <button type="button" className="nexus-button-primary" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}{uploading ? t("uploading") : t("upload")}
          </button>
          <input ref={fileInputRef} aria-label={t("upload_label")} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" multiple className="sr-only" onChange={(event) => void handleUpload(event.target.files)} />
        </header>

        <div className="mb-4 flex gap-1 overflow-x-auto border-b border-slate-200 dark:border-white/10" role="group" aria-label={t("categories")}>
          {filters.map((item) => <button key={item.id} type="button" aria-pressed={filter === item.id} onClick={() => setFilter(item.id)} className={`min-h-11 shrink-0 border-b-2 px-3 text-sm font-medium ${filter === item.id ? "border-indigo-500 text-indigo-600 dark:text-indigo-300" : "border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-white"}`}>{item.label}{item.id === "all" ? ` ${documents.length}` : ""}</button>)}
        </div>

        <div className="mb-5 flex flex-wrap items-center gap-3">
          <label className="relative min-w-0 flex-1 sm:max-w-md"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input type="search" aria-label={t("search_label")} placeholder={t("search_placeholder")} className="nexus-input w-full pl-9" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
          <span className="text-sm text-slate-500">{t("results", { count: filteredDocuments.length })}</span>
        </div>

        {uploadError && <p role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">{uploadError}</p>}
        {actionError && <p role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">{actionError}</p>}

        {documentsQuery.isError ? (
          <section className="rounded-xl border border-slate-200 bg-white p-8 text-center dark:border-white/10 dark:bg-[#111214]"><p className="text-sm text-slate-600 dark:text-slate-300">{t("load_error")}</p><button type="button" className="nexus-button-ghost mt-4" onClick={() => void documentsQuery.refetch()}>{t("retry")}</button></section>
        ) : documentsQuery.isLoading ? (
          <div className="flex justify-center py-20"><Loader2 aria-label={t("loading")} className="h-6 w-6 animate-spin text-indigo-500" /></div>
        ) : documents.length === 0 ? (
          <section className="rounded-xl border border-dashed border-slate-300 bg-white p-12 text-center dark:border-white/10 dark:bg-[#111214]"><FileText className="mx-auto h-8 w-8 text-slate-400" /><p className="mt-3 text-sm text-slate-500">{t("no_files")}</p></section>
        ) : (
          <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
            <section className={`overflow-hidden rounded-xl border bg-white dark:bg-[#111214] ${dragOver ? "border-indigo-400 bg-indigo-50/40 dark:bg-indigo-500/5" : "border-slate-200 dark:border-white/10"}`} onDragOver={(event) => { event.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={(event) => { event.preventDefault(); setDragOver(false); void handleUpload(event.dataTransfer.files); }}>
              <div className="hidden grid-cols-[1fr_auto] border-b border-slate-200 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500 sm:grid dark:border-white/8"><span>{t("file_and_link")}</span><span>{t("updated")}</span></div>
              {filteredDocuments.length === 0 ? <p className="px-5 py-12 text-center text-sm text-slate-500">{t("no_matches")}</p> : filteredDocuments.map((document) => {
                const active = selectedId === document.id; const applications = document.applications ?? [];
                return <button type="button" key={document.id} id={`document-${encodeURIComponent(document.id)}`} aria-pressed={active} aria-label={`${document.originalName}, ${t(`kind_${documentKind(document)}`)}`} onClick={() => selectDocument(document)} className={`grid w-full grid-cols-[auto_minmax(0,1fr)] gap-3 border-b border-slate-100 px-4 py-4 text-left last:border-b-0 sm:grid-cols-[auto_minmax(0,1fr)_auto] dark:border-white/6 ${active ? "bg-indigo-50/70 dark:bg-indigo-500/8" : "hover:bg-slate-50 dark:hover:bg-white/[0.025]"}`}>
                  <span className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-500 dark:bg-white/5">{document.mimeType.startsWith("image/") ? <FileImage className="h-4 w-4" /> : <FileText className="h-4 w-4" />}</span>
                  <span className="min-w-0"><span className="block truncate text-sm font-medium text-slate-900 dark:text-white">{document.originalName}</span><span className="mt-1 block truncate text-xs text-slate-500">{applications.length ? applications.map((application) => `${application.company} — ${application.role}`).join(", ") : t("unlinked")}</span></span>
                  <time className="col-start-2 text-xs text-slate-500 sm:col-start-auto" dateTime={document.uploadedAt}>{format(new Date(document.uploadedAt), "dd MMM yyyy", { locale: dateLocale })}</time>
                </button>;
              })}
              <button type="button" onClick={() => fileInputRef.current?.click()} className="flex min-h-12 w-full items-center justify-center gap-2 border-t border-dashed border-slate-300 text-xs text-slate-500 hover:text-indigo-600 dark:border-white/10"><Upload className="h-3.5 w-3.5" />{t("drop_note")}</button>
            </section>

            {selected && <aside aria-label={t("selected_document")} className="rounded-xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-[#111214] lg:sticky lg:top-6">
              <div className="mb-5 flex h-32 items-center justify-center rounded-xl bg-slate-100 dark:bg-white/5">{selected.mimeType.startsWith("image/") ? <FileImage className="h-12 w-12 text-slate-400" /> : <FileText className="h-12 w-12 text-slate-400" />}</div>
              {renaming ? <form onSubmit={(event) => { event.preventDefault(); const value = renameValue.trim(); if (value && value !== selected.originalName) renameMutation.mutate({ id: selected.id, originalName: value }); else setRenaming(false); }} className="space-y-2">
                <label className="text-xs font-medium text-slate-600 dark:text-slate-300">{t("filename")}<input autoFocus className="nexus-input mt-1 w-full" value={renameValue} onChange={(event) => setRenameValue(event.target.value)} /></label><div className="flex gap-2"><button type="button" className="nexus-button-ghost" onClick={() => setRenaming(false)}>{t("cancel")}</button><button type="submit" className="nexus-button-primary">{t("save")}</button></div>
              </form> : <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h2 className="break-words text-base font-semibold text-slate-950 dark:text-white">{selected.originalName}</h2><p className="mt-1 text-xs text-slate-500">{t(`kind_${documentKind(selected)}`)} · {fileFormat(selected)}</p></div>{!selected.submissionId && selected.state !== "historical" && selected.state !== "submitted" && <button type="button" aria-label={t("rename")} className="nexus-button-ghost px-2" onClick={() => { setRenameValue(selected.originalName); setRenaming(true); }}><Pencil className="h-4 w-4" /></button>}</div>}

              <dl className="my-5 grid grid-cols-2 gap-x-4 gap-y-3 text-xs"><dt className="text-slate-500">{t("file_type")}</dt><dd className="text-right text-slate-800 dark:text-slate-200">{fileFormat(selected)}</dd><dt className="text-slate-500">{t("file_size")}</dt><dd className="text-right text-slate-800 dark:text-slate-200">{formatBytes(selected.size)}</dd><dt className="text-slate-500">{t("updated")}</dt><dd className="text-right text-slate-800 dark:text-slate-200">{format(new Date(selected.uploadedAt), "dd MMM yyyy", { locale: dateLocale })}</dd><dt className="text-slate-500">{t("version")}</dt><dd className="text-right text-slate-800 dark:text-slate-200">{selected.version ?? 1}</dd></dl>

              <div className="border-t border-slate-200 py-5 dark:border-white/8"><h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">{t("linked_opportunities")}</h3><div className="mt-3 space-y-2">{(selected.applications ?? []).map((application) => <div key={application.id} className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 dark:bg-white/[0.03]"><Link className="min-w-0 flex-1 truncate text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-300" href={`/applications/${application.id}`}>{application.company} — {application.role}</Link>{!selected.submissionId && <button type="button" aria-label={t("unlink_from", { company: application.company })} onClick={() => linkMutation.mutate({ id: selected.id, applicationIds: selectedApplicationIds.filter((id) => id !== application.id) })}><X className="h-3.5 w-3.5 text-slate-400 hover:text-red-500" /></button>}</div>)}{!selected.applications?.length && <p className="text-xs text-slate-500">{t("unlinked")}</p>}</div>
                {!selected.submissionId && selected.state !== "historical" && selected.state !== "submitted" && <form className="mt-3 flex gap-2" onSubmit={(event) => { event.preventDefault(); if (linkApplicationId) linkMutation.mutate({ id: selected.id, applicationIds: [...new Set([...selectedApplicationIds, linkApplicationId])] }); }}><select aria-label={t("link_opportunity")} className="nexus-input min-w-0 flex-1" value={linkApplicationId} onChange={(event) => setLinkApplicationId(event.target.value)}><option value="">{t("choose_opportunity")}</option>{(applicationsQuery.data ?? []).filter((application) => !selectedApplicationIds.includes(application.id)).map((application) => <option key={application.id} value={application.id}>{application.company} — {application.role}</option>)}</select><button type="submit" aria-label={t("add_link")} disabled={!linkApplicationId || linkMutation.isPending} className="nexus-button-ghost px-3"><Link2 className="h-4 w-4" /></button></form>}
              </div>

              <div className="border-t border-slate-200 py-5 dark:border-white/8"><h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">{t("sharing")}</h3><p className="mt-3 flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">{selectedShareLink ? <Share2 className="h-4 w-4 text-indigo-500" /> : <LockKeyhole className="h-4 w-4" />}{selectedShareLink ? t("shared") : t("private")}</p><div className="mt-3 flex flex-wrap gap-2">{selectedShareLink ? <><button type="button" className="nexus-button-ghost" onClick={() => void copyText(`${window.location.origin}/s/${selectedShareLink.code}`)}>{t("copy_link")}</button><button type="button" className="nexus-button-ghost text-red-600" onClick={() => revokeShareMutation.mutate(selectedShareLink)}>{t("revoke_link")}</button></> : <button type="button" className="nexus-button-ghost" disabled={createShareMutation.isPending} onClick={() => createShareMutation.mutate(selected)}>{t("create_link")}</button>}</div></div>

              <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-5 dark:border-white/8"><a className="nexus-button-ghost" href={`/api/documents/${selected.id}/file`} download={selected.originalName}><ExternalLink className="h-4 w-4" />{t("download")}</a>{!selected.submissionId && selected.state !== "historical" && selected.state !== "submitted" && <button type="button" className="nexus-button-ghost text-red-600" onClick={() => { if (window.confirm(t("confirm_delete", { name: selected.originalName }))) deleteMutation.mutate(selected); }}><Trash2 className="h-4 w-4" />{t("delete")}</button>}</div>
            </aside>}
          </div>
        )}
      </main>
    </div>
  );
}
