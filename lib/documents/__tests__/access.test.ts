import { describe, expect, it } from "vitest";
import {
  isSubmissionDocument,
  requiresSubmissionScopeForDocumentMutation,
} from "../access";

describe("submission document access policy", () => {
  it("identifies linked, submitted, and historical artifacts as sensitive", () => {
    expect(isSubmissionDocument({ submissionId: "submission-1", state: "current" })).toBe(true);
    expect(isSubmissionDocument({ submissionId: null, state: "submitted" })).toBe(true);
    expect(isSubmissionDocument({ submissionId: null, state: "historical" })).toBe(true);
    expect(isSubmissionDocument({ submissionId: null, state: "current" })).toBe(false);
  });

  it("requires submission scope before entering a sensitive lifecycle state", () => {
    const current = { submissionId: null, state: "current" };
    expect(requiresSubmissionScopeForDocumentMutation(current, "submitted")).toBe(true);
    expect(requiresSubmissionScopeForDocumentMutation(current, "historical")).toBe(true);
    expect(requiresSubmissionScopeForDocumentMutation(current, "superseded")).toBe(false);
  });

  it("requires submission scope for same-state updates of immutable artifacts", () => {
    expect(requiresSubmissionScopeForDocumentMutation({ submissionId: "submission-1", state: "submitted" }, "submitted"))
      .toBe(true);
    expect(requiresSubmissionScopeForDocumentMutation({ submissionId: null, state: "historical" }, "historical"))
      .toBe(true);
  });
});