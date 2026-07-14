import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { mockRecordApplicationSubmission, mockRequireAuth } = vi.hoisted(() => ({
  mockRecordApplicationSubmission: vi.fn(),
  mockRequireAuth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({ recordApplicationSubmission: mockRecordApplicationSubmission }),
}));
vi.mock("@/lib/session", () => ({ requireAuth: mockRequireAuth }));

import { POST } from "../route";

const params = { params: Promise.resolve({ id: "app-1" }) };
const policy = {
  humanReviewed: true,
  identityConsistent: true,
  factsVerified: true,
  profileConsistencyStatus: "verified",
};

function request(overrides: Record<string, unknown> = {}) {
  return new NextRequest("http://localhost/api/applications/app-1/submissions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      idempotencyKey: "submission-key-1",
      submittedAt: "2026-07-14T09:00:00.000Z",
      answers: [{ question: "Why?", answer: "Because" }],
      documentIds: ["doc-1"],
      policy,
      ...overrides,
    }),
  });
}

function result(overrides: Record<string, unknown> = {}) {
  return {
    replayed: false,
    dryRun: false,
    verified: true,
    application: { id: "app-1" },
    submission: { id: "submission-1", policy },
    event: { id: "event-1" },
    documents: [{ id: "doc-1" }],
    ...overrides,
  };
}

describe("POST /api/applications/:id/submissions", () => {
  it("returns the direct result with 201 for a new submission", async () => {
    mockRequireAuth.mockResolvedValue({ userId: "user-1", user: { email: "user@example.com" } });
    mockRecordApplicationSubmission.mockResolvedValue(result());

    const response = await POST(request(), params);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toMatchObject({ submission: { id: "submission-1" }, replayed: false });
    expect(body).not.toHaveProperty("data");
  });

  it("returns 200 and preserves legacy REST document shapes until adapter replay lookup", async () => {
    mockRequireAuth.mockResolvedValue({ userId: "user-1", user: { email: "user@example.com" } });
    mockRecordApplicationSubmission.mockResolvedValue(result({ replayed: true }));
    const legacyDocumentIds = Array.from({ length: 21 }, (_, index) => index);

    const response = await POST(request({ policy: undefined, documentIds: legacyDocumentIds }), params);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.replayed).toBe(true);
    expect(mockRecordApplicationSubmission).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ documentIds: legacyDocumentIds, policy: undefined }),
    );
  });

  it("maps submitted-document reuse to 409", async () => {
    mockRequireAuth.mockResolvedValue({ userId: "user-1", user: { email: "user@example.com" } });
    mockRecordApplicationSubmission.mockRejectedValue(new Error("document_already_submitted"));

    const response = await POST(request(), params);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "document_already_submitted" });
  });
});

type ResponseSchema = { $ref?: string };
type OperationResponse = { content?: { "application/json"?: { schema?: ResponseSchema } } };
type RequestVariant = {
  title?: string;
  required?: string[];
  properties?: { policy?: { not?: Record<string, never> } };
};
type OpenApiContract = {
  paths: Record<string, {
    post?: {
      requestBody?: { content?: { "application/json"?: { schema?: { oneOf?: RequestVariant[] } } } };
      responses?: Record<string, OperationResponse>;
    };
  }>;
};

describe("published submission OpenAPI contract", () => {
  const contract = JSON.parse(
    readFileSync(resolve(process.cwd(), "public/openapi.json"), "utf8"),
  ) as OpenApiContract;
  const operation = contract.paths["/api/applications/{id}/submissions"].post!;

  it("documents direct 200 replay/dry-run and 201 creation results", () => {
    expect(operation.responses?.["200"].content?.["application/json"]?.schema?.$ref)
      .toBe("#/components/schemas/RecordSubmissionResult");
    expect(operation.responses?.["201"].content?.["application/json"]?.schema?.$ref)
      .toBe("#/components/schemas/RecordSubmissionResult");
  });

  it("separates strict new submissions from policy-free exact legacy replays", () => {
    const variants = operation.requestBody?.content?.["application/json"]?.schema?.oneOf;
    expect(variants?.map((variant) => variant.title)).toEqual([
      "NewSubmissionRequest",
      "ExactLegacySubmissionReplayRequest",
    ]);
    expect(variants?.[0].required).toContain("policy");
    expect(variants?.[1].properties?.policy?.not).toEqual({});
  });
});
