"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { AppHeader } from "./app-header";
import { BulkReview } from "./ai-operator/bulk-review";
import { publishAssistantContext } from "./ai-operator/context";

export function TaskWorkspace({ user, commandId }: { user: { name?: string | null; email: string; isAdmin?: boolean }; commandId: string }) {
  const router = useRouter();
  const t = useTranslations("bulk_review");
  const nav = useTranslations("nav");
  useEffect(() => {
    publishAssistantContext({ route: `/tasks/${commandId}`, activeRecordId: null, filters: {}, visibleIds: [], visibleCount: 0, selectedIds: [], dirtyEditorIds: [], taskIds: [commandId], capabilities: ["navigate", "open_record", "open_review"] });
  }, [commandId]);
  return <div className="nexus-shell">
    <AppHeader user={user} />
    <main className="mx-auto max-w-6xl px-4 py-7 sm:px-7">
      <Link href="/" className="nexus-focus-ring inline-flex min-h-11 items-center text-sm text-violet-700 dark:text-violet-300">← {nav("opportunities")}</Link>
      <h1 className="mb-6 mt-3 text-[27px] font-semibold tracking-tight">{t("title")}</h1>
      <BulkReview commandId={commandId} onCommandChange={id => router.replace(`/tasks/${encodeURIComponent(id)}`)} />
    </main>
  </div>;
}
