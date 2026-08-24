import { useState } from "react";
import type { Application } from "@/types";
import { toFormData, type ApplicationFormData } from "./form-data";

/**
 * Whether `candidate` is a strictly later revision than `current`.
 *
 * Monotonic on purpose: a save answers with a record newer than the server prop
 * this page was rendered with, and adopting an older one afterwards would put
 * the user's own just-saved edit back to what it replaced.
 */
function isNewer(candidate: string | null, current: string | null): boolean {
  if (!candidate) return false;
  if (!current) return true;
  const next = Date.parse(candidate);
  const previous = Date.parse(current);
  if (Number.isNaN(next) || Number.isNaN(previous)) return candidate !== current;
  return next > previous;
}

function shallowEqualForm(
  a: ApplicationFormData,
  b: ApplicationFormData,
): boolean {
  for (const key of Object.keys(a) as (keyof ApplicationFormData)[]) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

/**
 * Shared form state for the create modal and the detail page.
 * `baseline` is the last known persisted state; `isDirty` compares against it.
 * `markSaved` must be called after every successful save so the optimistic
 * concurrency token (`baselineUpdatedAt`) stays in sync with the server.
 */
export function useApplicationForm(application: Application | null) {
  const [form, setForm] = useState<ApplicationFormData>(() =>
    toFormData(application),
  );
  const [baseline, setBaseline] = useState<ApplicationFormData>(form);
  const [baselineUpdatedAt, setBaselineUpdatedAt] = useState<string | null>(
    application?.updatedAt ?? null,
  );

  const isDirty = !shallowEqualForm(form, baseline);

  // `useState` reads its initializer once, so the baseline was frozen at mount
  // and nothing that changed the record from outside this form could move it.
  // `router.refresh()` re-renders the page with a newer record — after an agent
  // run mutated it, after a resume was tailored — and the form went on holding
  // the concurrency token from mount, so the user's next save answered 409 for
  // a change they had already been shown.
  //
  // Adopt a strictly newer server record, and only while there is nothing
  // unsaved to lose. With unsaved edits the stale token is the protection: the
  // 409 is what tells the user their copy is behind, and silently adopting the
  // new token would let them overwrite the change instead.
  if (
    application &&
    !isDirty &&
    isNewer(application.updatedAt, baselineUpdatedAt)
  ) {
    const next = toFormData(application);
    setForm(next);
    setBaseline(next);
    setBaselineUpdatedAt(application.updatedAt);
  }

  function handleChange(
    e: React.ChangeEvent<
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    >,
  ) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  }

  function patch(partial: Partial<ApplicationFormData>) {
    setForm((prev) => ({ ...prev, ...partial }));
  }

  function markSaved(saved: Application, submitted?: ApplicationFormData) {
    setBaseline(submitted ?? form);
    setBaselineUpdatedAt(saved.updatedAt);
  }

  /**
   * Adopt a server-side updatedAt produced outside the form (e.g. tailoring
   * a resume), so the next save does not collide with a stale baseline.
   */
  function refreshBaselineUpdatedAt(updatedAt: string) {
    setBaselineUpdatedAt(updatedAt);
  }

  return {
    form,
    setForm,
    handleChange,
    patch,
    isDirty,
    baselineUpdatedAt,
    markSaved,
    refreshBaselineUpdatedAt,
  };
}
