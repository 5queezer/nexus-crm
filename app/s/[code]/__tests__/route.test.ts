import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const { mockGetShareLinkByCode, mockGetDocument, mockFileExists, mockDownloadFile } = vi.hoisted(() => ({
  mockGetShareLinkByCode: vi.fn(),
  mockGetDocument: vi.fn(),
  mockFileExists: vi.fn(),
  mockDownloadFile: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    getShareLinkByCode: mockGetShareLinkByCode,
    getDocument: mockGetDocument,
  }),
}));

vi.mock("@/lib/storage", () => ({
  fileExists: mockFileExists,
  downloadFile: mockDownloadFile,
}));

import { GET } from "../route";

function makeRequest(url = "http://localhost/s/share123") {
  return new NextRequest(url);
}

function makeParams(code = "share123") {
  return { params: Promise.resolve({ code }) };
}

describe("GET /s/[code]", () => {
  const previousBetterAuthUrl = process.env.BETTER_AUTH_URL;
  const previousPublicReadToken = process.env.PUBLIC_READ_TOKEN;

  beforeEach(() => {
    vi.resetAllMocks();
    process.env.BETTER_AUTH_URL = "https://nexus.example.com";
    process.env.PUBLIC_READ_TOKEN = "legacy-public-token";
  });

  afterEach(() => {
    if (previousBetterAuthUrl === undefined) {
      delete process.env.BETTER_AUTH_URL;
    } else {
      process.env.BETTER_AUTH_URL = previousBetterAuthUrl;
    }

    if (previousPublicReadToken === undefined) {
      delete process.env.PUBLIC_READ_TOKEN;
    } else {
      process.env.PUBLIC_READ_TOKEN = previousPublicReadToken;
    }
  });

  it("redirects share-page links using the per-link code, not the global public token", async () => {
    mockGetShareLinkByCode.mockResolvedValue({
      id: "1",
      code: "share123",
      userId: "user-1",
      targetType: "share_page",
      targetId: null,
      createdAt: new Date(),
    });

    const res = await GET(makeRequest("http://localhost/s/share123?lang=en"), makeParams("share123"));

    expect(res.status).toBe(307);
    const location = res.headers.get("location") ?? "";
    expect(location).toBe("https://nexus.example.com/share?code=share123&lang=en");
    expect(location).not.toContain("legacy-public-token");
    expect(location).not.toContain("token=");
  });

  it("loads document share targets scoped to the link owner's userId", async () => {
    mockGetShareLinkByCode.mockResolvedValue({
      id: "1",
      code: "doc123",
      userId: "user-1",
      targetType: "document",
      targetId: "42",
      createdAt: new Date(),
    });
    mockGetDocument.mockResolvedValue({
      id: "42",
      userId: "user-1",
      filename: "stored.pdf",
      originalName: "CV.pdf",
      mimeType: "application/pdf",
      size: 8,
      uploadedAt: new Date(),
    });
    mockFileExists.mockResolvedValue(true);
    mockDownloadFile.mockResolvedValue(Buffer.from("pdf-bytes"));

    const res = await GET(makeRequest("http://localhost/s/doc123"), makeParams("doc123"));

    expect(mockGetDocument).toHaveBeenCalledWith("42", "user-1");
    expect(res.status).toBe(200);
  });

  it("rejects a document share if the resolved document owner does not match the link owner", async () => {
    mockGetShareLinkByCode.mockResolvedValue({
      id: "1",
      code: "doc123",
      userId: "user-1",
      targetType: "document",
      targetId: "42",
      createdAt: new Date(),
    });
    mockGetDocument.mockResolvedValue({
      id: "42",
      userId: "user-2",
      filename: "stored.pdf",
      originalName: "CV.pdf",
      mimeType: "application/pdf",
      size: 8,
      uploadedAt: new Date(),
    });

    const res = await GET(makeRequest("http://localhost/s/doc123"), makeParams("doc123"));

    expect(mockDownloadFile).not.toHaveBeenCalled();
    expect(res.status).toBe(404);
  });
});
