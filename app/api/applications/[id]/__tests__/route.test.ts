import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getApplication: vi.fn(),
  updateApplication: vi.fn(),
  requireAuth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getDb: () => ({ getApplication: mocks.getApplication, updateApplication: mocks.updateApplication }) }));
vi.mock("@/lib/session", () => ({ requireAuth: mocks.requireAuth }));

import { PATCH } from "../route";

const current = {
  id: "1",
  userId: "owner-1",
  company: "Acme",
  role: "Engineer",
  status: "interview",
  currentStage: "technical",
  appliedAt: new Date("2026-07-01T00:00:00.000Z"),
  lastContact: new Date("2026-07-20T00:00:00.000Z"),
  followUpAt: new Date("2026-07-30T00:00:00.000Z"),
  notes: "x".repeat(10_001),
  updatedAt: new Date("2026-07-24T08:00:00.000Z"),
};

function request(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/applications/1", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const context = { params: Promise.resolve({ id: "1" }) };

describe("PATCH /api/applications/:id event-first boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue({ userId: "owner-1" });
    mocks.getApplication.mockResolvedValue(current);
    mocks.updateApplication.mockImplementation(async (_id, _userId, update) => ({ ...current, ...update }));
  });

  it("allows unrelated edits while preserving an unchanged oversized legacy summary", async () => {
    const response = await PATCH(request({ company: "Acme 2", notes: current.notes }), context);
    expect(response.status).toBe(200);
    expect(mocks.updateApplication).toHaveBeenCalledWith("1", "owner-1", expect.not.objectContaining({ notes: expect.anything() }));
  });

  it("rejects direct lifecycle changes that would bypass immutable history", async () => {
    const response = await PATCH(request({ status: "offer" }), context);
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: "lifecycle_event_required", fields: ["status"] });
    expect(mocks.updateApplication).not.toHaveBeenCalled();
  });

  it("omits unchanged lifecycle fields from the mutable update", async () => {
    const response = await PATCH(request({ company: "Acme 2", status: "interview", currentStage: "technical" }), context);
    expect(response.status).toBe(200);
    expect(mocks.updateApplication).toHaveBeenCalledWith("1", "owner-1", expect.not.objectContaining({ status: expect.anything(), currentStage: expect.anything() }));
  });
});
