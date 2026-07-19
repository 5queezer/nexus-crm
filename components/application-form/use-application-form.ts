import { useState } from "react";
import type { Application } from "@/types";
import { toFormData, type ApplicationFormData } from "./form-data";

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
    isDirty: !shallowEqualForm(form, baseline),
    baselineUpdatedAt,
    markSaved,
    refreshBaselineUpdatedAt,
  };
}
