import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createApplication: vi.fn(),
  requireAuth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getDb: () => ({ createApplication: mocks.createApplication }) }));
vi.mock("@/lib/session", () => ({ requireAuth: mocks.requireAuth }));

import { POST } from "../route";

function request() {
  return new NextRequest("http://localhost/api/applications", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ company: "Acme", role: "Engineer" }),
  });
}

describe("POST /api/applications demo lifecycle conflict", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue({ userId: "owner-1" });
  });

  it("returns a controlled conflict requiring demo removal", async () => {
    mocks.createApplication.mockRejectedValue(new Error("demo_workspace_exists"));

    const response = await POST(request());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "demo_workspace_removal_required" });
  });
});
