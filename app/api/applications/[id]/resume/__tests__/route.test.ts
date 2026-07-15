import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockRequireAuth,
  mockGetApplication,
  mockGetResumeEditUrl,
  mockIsConfigured,
} = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockGetApplication: vi.fn(),
  mockGetResumeEditUrl: vi.fn(),
  mockIsConfigured: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  requireAuth: mockRequireAuth,
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({ getApplication: mockGetApplication }),
}));

vi.mock("@/lib/reactive-resume", () => ({
  getResumeEditUrl: mockGetResumeEditUrl,
  isConfigured: mockIsConfigured,
}));

import { GET } from "../route";

function request() {
  return new NextRequest("http://localhost/api/applications/application-1/resume");
}

const params = { params: Promise.resolve({ id: "application-1" }) };

describe("GET /api/applications/[id]/resume", () => {
  beforeEach(() => {
    mockRequireAuth.mockReset();
    mockGetApplication.mockReset();
    mockGetResumeEditUrl.mockReset();
    mockIsConfigured.mockReset();
    mockIsConfigured.mockReturnValue(true);
  });

  it("requires authentication", async () => {
    mockRequireAuth.mockResolvedValue(null);

    const response = await GET(request(), params);

    expect(response.status).toBe(401);
  });

  it("does not expose another user's application", async () => {
    mockRequireAuth.mockResolvedValue({ userId: "user-1" });
    mockGetApplication.mockResolvedValue(null);

    const response = await GET(request(), params);

    expect(mockGetApplication).toHaveBeenCalledWith("application-1", "user-1");
    expect(response.status).toBe(404);
  });

  it("redirects an owned linked resume to Reactive Resume", async () => {
    mockRequireAuth.mockResolvedValue({ userId: "user-1" });
    mockGetApplication.mockResolvedValue({ resumeId: "resume-1" });
    mockGetResumeEditUrl.mockReturnValue(
      "https://resume.example/dashboard/resumes/resume-1",
    );

    const response = await GET(request(), params);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://resume.example/dashboard/resumes/resume-1",
    );
  });

  it("returns not found when the application has no linked resume", async () => {
    mockRequireAuth.mockResolvedValue({ userId: "user-1" });
    mockGetApplication.mockResolvedValue({ resumeId: null });

    const response = await GET(request(), params);

    expect(response.status).toBe(404);
    expect(mockGetResumeEditUrl).not.toHaveBeenCalled();
  });

  it("returns service unavailable when Reactive Resume is not configured", async () => {
    mockRequireAuth.mockResolvedValue({ userId: "user-1" });
    mockGetApplication.mockResolvedValue({ resumeId: "resume-1" });
    mockIsConfigured.mockReturnValue(false);

    const response = await GET(request(), params);

    expect(response.status).toBe(501);
    expect(mockGetResumeEditUrl).not.toHaveBeenCalled();
  });
});
