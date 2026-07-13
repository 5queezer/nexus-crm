import { describe, expect, it } from "vitest";
import {
  canonicalizeJobUrl,
  computeApplicationHealth,
  validateSubmissionAnswers,
} from "../submission";

describe("canonicalizeJobUrl", () => {
  it("normalizes scheme/host, removes fragments, tracking parameters, and trailing slash", () => {
    expect(
      canonicalizeJobUrl("HTTPS://Jobs.Example.com/roles/123/?utm_source=mail&ref=alert#apply"),
    ).toBe("https://jobs.example.com/roles/123");
  });

  it("keeps identity-bearing query parameters in stable order", () => {
    expect(canonicalizeJobUrl("https://example.com/job?b=2&id=7&a=1")).toBe(
      "https://example.com/job?a=1&b=2&id=7",
    );
  });

  it("rejects non-http URLs", () => {
    expect(() => canonicalizeJobUrl("file:///etc/passwd")).toThrowError(/http/i);
  });
});

describe("validateSubmissionAnswers", () => {
  it("trims valid answers and preserves structured metadata", () => {
    expect(
      validateSubmissionAnswers([
        { key: "why", question: " Why us? ", answer: " Because. ", kind: "text", sensitive: false },
      ]),
    ).toEqual([
      { key: "why", question: "Why us?", answer: " Because. ", kind: "text", sensitive: false },
    ]);
  });

  it("rejects empty questions and excessive answer counts", () => {
    expect(() => validateSubmissionAnswers([{ question: " ", answer: "x" }])).toThrowError(
      /question/i,
    );
    expect(() =>
      validateSubmissionAnswers(
        Array.from({ length: 51 }, (_, i) => ({ question: `Q${i}`, answer: "x" })),
      ),
    ).toThrowError(/50/);
  });

  it("rejects oversized answers", () => {
    expect(() =>
      validateSubmissionAnswers([{ question: "Q", answer: "x".repeat(20_001) }]),
    ).toThrowError(/20000/);
  });

  it("rejects answer packages that exceed the Firestore-safe aggregate size", () => {
    const answers = Array.from({ length: 40 }, (_, index) => ({
      question: `Question ${index}`,
      answer: "x".repeat(20_000),
    }));
    expect(() => validateSubmissionAnswers(answers)).toThrowError(/750000-byte/);
  });
});

describe("computeApplicationHealth", () => {
  const now = new Date("2026-07-13T10:00:00.000Z");

  it("finds applied applications without a structured submission", () => {
    const findings = computeApplicationHealth({
      applications: [{ id: "1", status: "applied", appliedAt: now, followUpAt: null }],
      submissions: [],
      documents: [],
      now,
    });
    expect(findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining(["applied_without_submission", "missing_next_action"]),
    );
  });

  it("finds incomplete submission packages and orphan documents", () => {
    const findings = computeApplicationHealth({
      applications: [{ id: "1", status: "applied", appliedAt: now, followUpAt: now }],
      submissions: [{ id: "s1", applicationId: "1", answers: [], documentIds: [] }],
      documents: [{ id: "d1", applicationIds: [], state: "current" }],
      now,
    });
    expect(findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining(["submission_without_answers", "submission_without_materials", "orphan_document"]),
    );
  });

  it("does not classify rejected linked material as orphaned", () => {
    const findings = computeApplicationHealth({
      applications: [{ id: "1", status: "rejected", appliedAt: now, followUpAt: null }],
      submissions: [],
      documents: [{ id: "d1", applicationIds: ["1"], state: "historical" }],
      now,
    });
    expect(findings).toEqual([]);
  });
});
