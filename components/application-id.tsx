/**
 * Subtle `#170` reference for an application. Only numeric ids are shown;
 * opaque document ids (Firestore, demo seeds) would be noise, not a handle.
 */
export function ApplicationId({ id, className = "" }: { id: string; className?: string }) {
  if (!/^\d+$/.test(id)) return null;
  return (
    <span
      className={`shrink-0 font-mono text-[11px] tabular-nums text-slate-400 dark:text-slate-500 ${className}`}
    >
      #{id}
    </span>
  );
}
