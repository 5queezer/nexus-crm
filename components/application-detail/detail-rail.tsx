"use client";

/** Right-hand context column shared by the Activity and Brief tabs. */
export function DetailRail({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <aside
      aria-label={label}
      className="space-y-5 border-t border-slate-200/80 pt-5 dark:border-white/8 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0"
    >
      {children}
    </aside>
  );
}

export function RailSection({
  title,
  kicker,
  children,
}: {
  title?: string;
  kicker?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2 border-slate-200/80 [&+&]:border-t [&+&]:pt-5 dark:border-white/8">
      {kicker && (
        <div className="text-[11px] text-slate-500 dark:text-slate-400">{kicker}</div>
      )}
      {title && (
        <h2 className="text-[13px] font-semibold text-slate-950 dark:text-[#f7f8f8]">
          {title}
        </h2>
      )}
      {children}
    </section>
  );
}

export function RailProperties({ rows }: { rows: [string, string][] }) {
  if (rows.length === 0) return null;
  return (
    <dl className="space-y-2.5 text-xs">
      {rows.map(([label, value]) => (
        <div key={label}>
          {/* Stacked rather than two columns: translated labels get long and
              the rail is narrow, so a label column would collide or hyphenate. */}
          <dt className="text-slate-500 dark:text-slate-400">{label}</dt>
          <dd className="m-0 break-words text-slate-800 dark:text-slate-200">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
