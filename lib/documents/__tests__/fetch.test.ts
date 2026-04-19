import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetDocument, mockFileExists } = vi.hoisted(() => ({
  mockGetDocument: vi.fn(),
  mockFileExists: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({ getDocument: mockGetDocument }),
}));

vi.mock("@/lib/storage", () => ({
  fileExists: mockFileExists,
}));

import { loadOwnedDocument } from "../fetch";

const fixtureDoc = {
  id: "doc-1",
  userId: "user-1",
  filename: "abc.pdf",
  originalName: "CV.pdf",
  size: 1234,
  mimeType: "application/pdf",
  uploadedAt: new Date("2025-01-01"),
};

describe("loadOwnedDocument", () => {
  beforeEach(() => {
    mockGetDocument.mockReset();
    mockFileExists.mockReset();
  });

  it("returns ok with the document when found and file exists", async () => {
    mockGetDocument.mockResolvedValue(fixtureDoc);
    mockFileExists.mockResolvedValue(true);

    const res = await loadOwnedDocument("doc-1", "user-1");
    expect(res).toEqual({ ok: true, doc: fixtureDoc });
    expect(mockGetDocument).toHaveBeenCalledWith("doc-1", "user-1");
  });

  it("returns not_found when the doc record is missing", async () => {
    mockGetDocument.mockResolvedValue(null);

    const res = await loadOwnedDocument("missing", "user-1");
    expect(res).toEqual({ ok: false, reason: "not_found" });
    expect(mockFileExists).not.toHaveBeenCalled();
  });

  it("returns not_found when the doc is owned by a different user (scoped read)", async () => {
    // The DB adapter enforces ownership by returning null for the wrong scope.
    mockGetDocument.mockResolvedValue(null);

    const res = await loadOwnedDocument("doc-1", "user-2");
    expect(res).toEqual({ ok: false, reason: "not_found" });
    expect(mockGetDocument).toHaveBeenCalledWith("doc-1", "user-2");
  });

  it("returns file_missing when the record exists but the file is gone", async () => {
    mockGetDocument.mockResolvedValue(fixtureDoc);
    mockFileExists.mockResolvedValue(false);

    const res = await loadOwnedDocument("doc-1", "user-1");
    expect(res).toEqual({ ok: false, reason: "file_missing" });
  });

  it("passes null scope through for admin/global reads", async () => {
    mockGetDocument.mockResolvedValue(fixtureDoc);
    mockFileExists.mockResolvedValue(true);

    await loadOwnedDocument("doc-1", null);
    expect(mockGetDocument).toHaveBeenCalledWith("doc-1", null);
  });
});
