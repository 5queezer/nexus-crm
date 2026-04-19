import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { mockRequireAuth, mockLoadOwnedDocument, mockDownloadFile } = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockLoadOwnedDocument: vi.fn(),
  mockDownloadFile: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  requireAuth: mockRequireAuth,
}));

vi.mock("@/lib/documents/fetch", () => ({
  loadOwnedDocument: mockLoadOwnedDocument,
}));

vi.mock("@/lib/storage", () => ({
  downloadFile: mockDownloadFile,
}));

vi.mock("@/lib/token", () => ({
  safeCompare: (a: string, b: string) => a === b,
}));

import { GET } from "../route";

const fixtureDoc = {
  id: "doc-1",
  userId: "user-1",
  filename: "stored.pdf",
  originalName: "CV.pdf",
  size: 10,
  mimeType: "application/pdf",
  uploadedAt: new Date("2025-01-01"),
};

const fixtureBuffer = Buffer.from("%PDF-1.4\n", "utf8");

function makeRequest(url = "http://localhost/api/documents/doc-1/file") {
  return new NextRequest(url);
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("GET /api/documents/[id]/file", () => {
  beforeEach(() => {
    mockRequireAuth.mockReset();
    mockLoadOwnedDocument.mockReset();
    mockDownloadFile.mockReset();
  });

  it("returns 200 with the PDF bytes for an authenticated owner", async () => {
    mockRequireAuth.mockResolvedValue({
      userId: "user-1",
      readScopeUserId: "user-1",
      user: { id: "user-1", name: null, email: "u@x", image: null, isAdmin: false },
    });
    mockLoadOwnedDocument.mockResolvedValue({ ok: true, doc: fixtureDoc });
    mockDownloadFile.mockResolvedValue(fixtureBuffer);

    const res = await GET(makeRequest(), makeParams("doc-1"));

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Length")).toBe(String(fixtureBuffer.length));
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.equals(fixtureBuffer)).toBe(true);
    expect(mockLoadOwnedDocument).toHaveBeenCalledWith("doc-1", "user-1");
  });

  it("returns 404 when the document record does not exist", async () => {
    mockRequireAuth.mockResolvedValue({
      userId: "user-1",
      readScopeUserId: "user-1",
      user: { id: "user-1", name: null, email: "u@x", image: null, isAdmin: false },
    });
    mockLoadOwnedDocument.mockResolvedValue({ ok: false, reason: "not_found" });

    const res = await GET(makeRequest(), makeParams("missing"));

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Not found");
  });

  it("returns 404 when the caller is not the owner (scoped read returns not_found)", async () => {
    // user-2 is asking for a doc owned by user-1; getDocument() returns null
    // when scoped to user-2, which the helper surfaces as not_found.
    mockRequireAuth.mockResolvedValue({
      userId: "user-2",
      readScopeUserId: "user-2",
      user: { id: "user-2", name: null, email: "w@x", image: null, isAdmin: false },
    });
    mockLoadOwnedDocument.mockResolvedValue({ ok: false, reason: "not_found" });

    const res = await GET(makeRequest(), makeParams("doc-1"));

    expect(res.status).toBe(404);
    expect(mockDownloadFile).not.toHaveBeenCalled();
    expect(mockLoadOwnedDocument).toHaveBeenCalledWith("doc-1", "user-2");
  });

  it("returns 401 when unauthenticated and no public token is provided", async () => {
    mockRequireAuth.mockResolvedValue(null);
    const res = await GET(makeRequest(), makeParams("doc-1"));
    expect(res.status).toBe(401);
    expect(mockLoadOwnedDocument).not.toHaveBeenCalled();
  });
});
