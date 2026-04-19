import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockGetDocument,
  mockFileExists,
  mockDownloadFile,
  mockIsGcsBacked,
  mockGetSignedUrl,
} = vi.hoisted(() => ({
  mockGetDocument: vi.fn(),
  mockFileExists: vi.fn(),
  mockDownloadFile: vi.fn(),
  mockIsGcsBacked: vi.fn(),
  mockGetSignedUrl: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({ getDocument: mockGetDocument }),
}));

vi.mock("@/lib/storage", () => ({
  fileExists: mockFileExists,
  downloadFile: mockDownloadFile,
  isGcsBacked: mockIsGcsBacked,
  getSignedDownloadUrl: mockGetSignedUrl,
}));

import { downloadDocumentContent } from "../download";

// Minimal valid PDF (just the header + EOF) — enough for %PDF- magic check.
const PDF_MAGIC = Buffer.from("%PDF-1.4\n%%EOF\n", "utf8");

const fixtureDoc = {
  id: "doc-1",
  userId: "user-1",
  filename: "stored.pdf",
  originalName: "CV - Acme - Engineer.pdf",
  size: PDF_MAGIC.length,
  mimeType: "application/pdf",
  uploadedAt: new Date("2025-01-01"),
};

describe("downloadDocumentContent", () => {
  beforeEach(() => {
    mockGetDocument.mockReset();
    mockFileExists.mockReset();
    mockDownloadFile.mockReset();
    mockIsGcsBacked.mockReset();
    mockGetSignedUrl.mockReset();
  });

  it("returns base64-encoded PDF content that decodes to valid PDF bytes", async () => {
    mockGetDocument.mockResolvedValue(fixtureDoc);
    mockFileExists.mockResolvedValue(true);
    mockDownloadFile.mockResolvedValue(PDF_MAGIC);
    mockIsGcsBacked.mockReturnValue(false);

    const res = await downloadDocumentContent("doc-1", "user-1");

    expect(res.isError).toBeUndefined();
    expect(res.content).toHaveLength(1);
    const payload = JSON.parse(res.content[0].text);
    expect(payload.id).toBe("doc-1");
    expect(payload.filename).toBe("CV - Acme - Engineer.pdf");
    expect(payload.mimeType).toBe("application/pdf");
    expect(payload.size).toBe(PDF_MAGIC.length);
    expect(typeof payload.contentBase64).toBe("string");
    expect(payload.contentBase64.length).toBeGreaterThan(0);

    const decoded = Buffer.from(payload.contentBase64, "base64");
    expect(decoded.slice(0, 5).toString("utf8")).toBe("%PDF-");
    expect(decoded.equals(PDF_MAGIC)).toBe(true);
  });

  it("returns a not-found error when the caller does not own the document", async () => {
    mockGetDocument.mockResolvedValue(null);

    const res = await downloadDocumentContent("doc-1", "user-2");

    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/not found|access denied/i);
    expect(mockDownloadFile).not.toHaveBeenCalled();
  });

  it("returns a file-missing error when the record exists but the blob is gone", async () => {
    mockGetDocument.mockResolvedValue(fixtureDoc);
    mockFileExists.mockResolvedValue(false);

    const res = await downloadDocumentContent("doc-1", "user-1");

    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/missing/i);
    expect(mockDownloadFile).not.toHaveBeenCalled();
  });

  it("returns a signed URL instead of inline base64 when size exceeds 1MB and GCS is available", async () => {
    const bigDoc = { ...fixtureDoc, size: 2 * 1024 * 1024 };
    mockGetDocument.mockResolvedValue(bigDoc);
    mockFileExists.mockResolvedValue(true);
    mockIsGcsBacked.mockReturnValue(true);
    mockGetSignedUrl.mockResolvedValue("https://storage.googleapis.com/signed?sig=abc");

    const res = await downloadDocumentContent("doc-1", "user-1");

    const payload = JSON.parse(res.content[0].text);
    expect(payload.signedUrl).toBe("https://storage.googleapis.com/signed?sig=abc");
    expect(payload.contentBase64).toBeUndefined();
    expect(payload.size).toBe(2 * 1024 * 1024);
    expect(mockDownloadFile).not.toHaveBeenCalled();
    expect(mockGetSignedUrl).toHaveBeenCalledWith("stored.pdf");
  });

  it("falls back to inline base64 for large files when GCS is not configured", async () => {
    const bigDoc = { ...fixtureDoc, size: 2 * 1024 * 1024 };
    const bigBuffer = Buffer.concat([PDF_MAGIC, Buffer.alloc(bigDoc.size - PDF_MAGIC.length)]);
    mockGetDocument.mockResolvedValue(bigDoc);
    mockFileExists.mockResolvedValue(true);
    mockIsGcsBacked.mockReturnValue(false);
    mockDownloadFile.mockResolvedValue(bigBuffer);

    const res = await downloadDocumentContent("doc-1", "user-1");

    const payload = JSON.parse(res.content[0].text);
    expect(payload.signedUrl).toBeUndefined();
    expect(typeof payload.contentBase64).toBe("string");
    expect(mockGetSignedUrl).not.toHaveBeenCalled();
  });
});
