import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { mockRecordApplicationEvent, mockListApplicationEventsFiltered, mockGetApplication, mockRequireAuth } = vi.hoisted(() => ({
  mockRecordApplicationEvent: vi.fn(),
  mockListApplicationEventsFiltered: vi.fn(),
  mockGetApplication: vi.fn(),
  mockRequireAuth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    recordApplicationEvent: mockRecordApplicationEvent,
    listApplicationEventsFiltered: mockListApplicationEventsFiltered,
    getApplication: mockGetApplication,
  }),
}));
vi.mock("@/lib/session", () => ({ requireAuth: mockRequireAuth }));

import { GET, POST } from "../route";

const params = { params: Promise.resolve({ id: "app-1" }) };
function request(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/applications/app-1/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /api/applications/:id/events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({ userId: "user-1", user: { email: "owner@example.com" } });
    mockGetApplication.mockResolvedValue({ id: "app-1" });
  });

  it("returns an owner-scoped cursor page in the requested order", async () => {
    mockListApplicationEventsFiltered.mockResolvedValue({ items: [{ id: "event-1" }], nextCursor: "next" });
    const response = await GET(new NextRequest("http://localhost/api/applications/app-1/events?limit=20&order=oldest&cursor=eyJ2ZXJzaW9uIjoxLCJvY2N1cnJlZEF0IjoiMjAyNi0wNy0yNFQwOTowMDowMC4wMDBaIiwiaWQiOiIxIn0"), params);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ items: [{ id: "event-1" }], nextCursor: "next" });
    expect(mockListApplicationEventsFiltered).toHaveBeenCalledWith("user-1", expect.objectContaining({
      applicationId: "app-1",
      order: "oldest",
      limit: 20,
      cursor: { version: 1, occurredAt: "2026-07-24T09:00:00.000Z", id: "1" },
    }));
  });

  it("returns 404 without querying events when the application is not owned", async () => {
    mockGetApplication.mockResolvedValue(null);
    const response = await GET(new NextRequest("http://localhost/api/applications/app-1/events"), params);
    expect(response.status).toBe(404);
    expect(mockListApplicationEventsFiltered).not.toHaveBeenCalled();
  });
});

describe("POST /api/applications/:id/events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({ userId: "user-1", user: { email: "owner@example.com" } });
  });

  it("rejects unknown event types before persistence", async () => {
    const response = await POST(request({ type: "anything_goes" }), params);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "event_type_invalid" });
    expect(mockRecordApplicationEvent).not.toHaveBeenCalled();
  });

  it("routes submission events through the atomic submission workflow", async () => {
    const response = await POST(request({ type: "application_submitted" }), params);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "submission_event_requires_submission_workflow" });
    expect(mockRecordApplicationEvent).not.toHaveBeenCalled();
  });

  it("requires a stable occurrence time for idempotent commands", async () => {
    const response = await POST(request({ type: "stage_changed", idempotencyKey: "stable-key", metadata: { toStage: "screen" } }), params);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "occurred_at_required_for_idempotency" });
  });

  it("normalizes and records a canonical command with REST provenance", async () => {
    mockRecordApplicationEvent.mockResolvedValue({
      event: { id: "event-1" },
      application: { id: "app-1", updatedAt: new Date("2026-07-24T10:00:00Z") },
      replayed: false,
    });
    const response = await POST(request({
      type: "interview_scheduled",
      occurredAt: "2026-07-24T09:00:00Z",
      idempotencyKey: "schedule-key",
      expectedUpdatedAt: "2026-07-23T09:00:00Z",
      metadata: { interviewType: "technical", scheduledAt: "2026-07-28T12:30:00Z" },
    }), params);
    expect(response.status).toBe(201);
    expect(mockRecordApplicationEvent).toHaveBeenCalledWith("app-1", "user-1", expect.objectContaining({
      type: "interview_scheduled",
      source: "rest",
      actor: "owner@example.com",
      contactId: null,
      outcome: null,
      metadata: expect.objectContaining({ scheduledAt: "2026-07-28T12:30:00.000Z" }),
    }));
  });

  it("marks idempotent replay responses", async () => {
    mockRecordApplicationEvent.mockResolvedValue({ event: { id: "event-1" }, application: { id: "app-1" }, replayed: true });
    const response = await POST(request({
      type: "stage_changed",
      occurredAt: "2026-07-24T09:00:00Z",
      idempotencyKey: "stage-key",
      metadata: { toStage: "screen" },
    }), params);
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Idempotent-Replay")).toBe("true");
  });

  it("maps stale projections and idempotency conflicts to 409", async () => {
    mockRecordApplicationEvent.mockRejectedValue(new Error("conflict"));
    const response = await POST(request({ type: "application_rejected", occurredAt: "2026-07-24T09:00:00Z" }), params);
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "conflict" });
  });
});
