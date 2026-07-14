import { describe, expect, it } from "vitest";
import {
  canonicalizeJobUrl,
  computeApplicationHealth,
  requireOccurredAtForIdempotency,
  validateSubmissionAnswers,
  validateSubmissionConflicts,
  validateSubmissionPolicy,
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

describe("validateSubmissionPolicy", () => {
  const validPolicy = {
    humanReviewed: true,
    identityConsistent: true,
    factsVerified: true,
    profileConsistencyStatus: "verified" as const,
  };

  it("normalizes a complete policy and bounded override reasons", () => {
    expect(validateSubmissionPolicy({
      policy: {
        ...validPolicy,
        confirmedNoAnswers: false,
        sameCompanyOverrideReason: "  Recruiter redirected me  ",
        resubmissionReason: " Employer requested correction ",
      },
      answers: [{ question: "Why us?", answer: "Exact answer" }],
      documentIds: ["doc-1"],
    })).toEqual({
      ...validPolicy,
      confirmedNoAnswers: false,
      sameCompanyOverrideReason: "Recruiter redirected me",
      resubmissionReason: "Employer requested correction",
    });
  });

  it.each([
    [{ ...validPolicy, humanReviewed: false }, "human_review_required"],
    [{ ...validPolicy, identityConsistent: false }, "identity_consistency_required"],
    [{ ...validPolicy, factsVerified: false }, "fact_verification_required"],
    [{ ...validPolicy, profileConsistencyStatus: "pending" }, "profile_consistency_review_required"],
  ])("rejects incomplete attestations", (policy, expected) => {
    expect(() => validateSubmissionPolicy({
      policy,
      answers: [{ question: "Q", answer: "A" }],
      documentIds: ["doc-1"],
    })).toThrow(expected);
  });

  it("requires submitted material", () => {
    expect(() => validateSubmissionPolicy({
      policy: validPolicy,
      answers: [{ question: "Q", answer: "A" }],
      documentIds: [],
    })).toThrow("submission_materials_required");
  });

  it("requires answers or an explicit no-answer confirmation", () => {
    expect(() => validateSubmissionPolicy({
      policy: validPolicy,
      answers: [],
      documentIds: ["doc-1"],
    })).toThrow("submission_answers_required");

    expect(validateSubmissionPolicy({
      policy: { ...validPolicy, profileConsistencyStatus: "unavailable_reviewed", confirmedNoAnswers: true },
      answers: [],
      documentIds: ["doc-1"],
    })).toMatchObject({
      profileConsistencyStatus: "unavailable_reviewed",
      confirmedNoAnswers: true,
    });
  });

  it("rejects oversized override reasons", () => {
    expect(() => validateSubmissionPolicy({
      policy: { ...validPolicy, resubmissionReason: "x".repeat(1001) },
      answers: [{ question: "Q", answer: "A" }],
      documentIds: ["doc-1"],
    })).toThrow("submission_policy_reason_too_long");
  });
});

describe("validateSubmissionConflicts", () => {
  const base = {
    applicationId: "app-1",
    company: " Example   Corp ",
    requisitionId: "REQ-7",
    atsName: "Greenhouse",
    existingSubmissionCount: 0,
    policy: {
      humanReviewed: true as const,
      identityConsistent: true as const,
      factsVerified: true as const,
      profileConsistencyStatus: "verified" as const,
      confirmedNoAnswers: false,
    },
    applications: [] as Array<{
      id: string;
      company: string;
      status: string;
      requisitionId: string | null;
      atsName: string | null;
    }>,
  };

  it("blocks a second submission unless a resubmission reason is present", () => {
    expect(() => validateSubmissionConflicts({ ...base, existingSubmissionCount: 1 }))
      .toThrow("application_already_submitted");
    expect(() => validateSubmissionConflicts({
      ...base,
      existingSubmissionCount: 1,
      policy: { ...base.policy, resubmissionReason: "Employer requested correction" },
    })).not.toThrow();
  });

  it("blocks the same requisition across normalized company records", () => {
    const applications = [{
      id: "app-2",
      company: "example corp",
      status: "rejected",
      requisitionId: " req-7 ",
      atsName: "greenhouse",
    }];
    expect(() => validateSubmissionConflicts({ ...base, applications }))
      .toThrow("duplicate_requisition");
  });

  it("does not collide equal requisition IDs from different ATS namespaces", () => {
    const applications = [{
      id: "app-2",
      company: "Example Corp",
      status: "rejected",
      requisitionId: "REQ-7",
      atsName: "Lever",
    }];
    expect(() => validateSubmissionConflicts({ ...base, applications })).not.toThrow();
  });

  it("blocks a parallel active same-company process unless explicitly overridden", () => {
    const applications = [{
      id: "app-2",
      company: "EXAMPLE CORP",
      status: "interview",
      requisitionId: "REQ-8",
      atsName: "Greenhouse",
    }];
    expect(() => validateSubmissionConflicts({ ...base, applications }))
      .toThrow("same_company_active_application");
    expect(() => validateSubmissionConflicts({
      ...base,
      applications,
      policy: { ...base.policy, sameCompanyOverrideReason: "Recruiter redirected me" },
    })).not.toThrow();
  });
});

describe("requireOccurredAtForIdempotency", () => {
  it("requires a stable timestamp when an idempotency key is supplied", () => {
    expect(() => requireOccurredAtForIdempotency("retry-key", undefined))
      .toThrow("occurred_at_required_for_idempotency");
    expect(() => requireOccurredAtForIdempotency("retry-key", "2026-07-13T20:00:00Z"))
      .not.toThrow();
    expect(() => requireOccurredAtForIdempotency(undefined, undefined)).not.toThrow();
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
