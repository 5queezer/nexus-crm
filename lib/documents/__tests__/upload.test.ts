import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockCreateDocument, mockUploadFile } = vi.hoisted(() => ({
  mockCreateDocument: vi.fn(),
  mockUploadFile: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({ createDocument: mockCreateDocument }),
}));

vi.mock("@/lib/storage", () => ({
  uploadFile: mockUploadFile,
}));

import {
  decodeBase64Content,
  MAX_DOCUMENT_UPLOAD_SIZE,
  uploadDocument,
  uploadDocumentContent,
} from "../upload";

const PDF_BYTES = Buffer.from("%PDF-1.4\n%%EOF\n", "utf8");
const fixtureDoc = {
  id: "doc-1",
  userId: "user-1",
  filename: "stored.pdf",
  originalName: "CV.pdf",
  size: PDF_BYTES.length,
  mimeType: "application/pdf",
  uploadedAt: new Date("2025-01-01"),
  applications: [],
};

describe("uploadDocument", () => {
  beforeEach(() => {
    mockCreateDocument.mockReset();
    mockUploadFile.mockReset();
    mockCreateDocument.mockResolvedValue(fixtureDoc);
  });

  it("stores validated content and creates a document record", async () => {
    const doc = await uploadDocument({
      userId: "user-1",
      originalName: "CV.pdf",
      mimeType: "application/pdf",
      buffer: PDF_BYTES,
      applicationIds: ["app-1"],
    });

    expect(doc).toBe(fixtureDoc);
    expect(mockUploadFile).toHaveBeenCalledWith(
      expect.stringMatching(/^[0-9a-f-]+\.pdf$/),
      PDF_BYTES,
      "application/pdf",
    );
    expect(mockCreateDocument).toHaveBeenCalledWith("user-1", {
      filename: expect.stringMatching(/^[0-9a-f-]+\.pdf$/),
      originalName: "CV.pdf",
      size: PDF_BYTES.length,
      mimeType: "application/pdf",
      applicationIds: ["app-1"],
    });
  });

  it("rejects files over 10MB before writing storage", async () => {
    await expect(
      uploadDocument({
        userId: "user-1",
        originalName: "big.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.alloc(MAX_DOCUMENT_UPLOAD_SIZE + 1),
      }),
    ).rejects.toThrow(/too large/i);

    expect(mockUploadFile).not.toHaveBeenCalled();
    expect(mockCreateDocument).not.toHaveBeenCalled();
  });

  it("rejects unsupported MIME types before writing storage", async () => {
    await expect(
      uploadDocument({
        userId: "user-1",
        originalName: "notes.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("hello"),
      }),
    ).rejects.toThrow(/unsupported/i);

    expect(mockUploadFile).not.toHaveBeenCalled();
    expect(mockCreateDocument).not.toHaveBeenCalled();
  });
});

describe("decodeBase64Content", () => {
  it("decodes standard base64 content", () => {
    expect(decodeBase64Content(PDF_BYTES.toString("base64")).equals(PDF_BYTES)).toBe(true);
  });

  it("rejects malformed base64", () => {
    expect(() => decodeBase64Content("not base64!")).toThrow(/invalid base64/i);
  });
});

describe("uploadDocumentContent", () => {
  beforeEach(() => {
    mockCreateDocument.mockReset();
    mockUploadFile.mockReset();
    mockCreateDocument.mockResolvedValue(fixtureDoc);
  });

  it("returns an MCP tool response with the created document", async () => {
    const res = await uploadDocumentContent(
      {
        filename: "CV.pdf",
        mimeType: "application/pdf",
        contentBase64: PDF_BYTES.toString("base64"),
      },
      "user-1",
    );

    expect(res.isError).toBeUndefined();
    expect(JSON.parse(res.content[0].text)).toMatchObject({
      id: "doc-1",
      originalName: "CV.pdf",
    });
  });

  it("returns an MCP error response for invalid base64", async () => {
    const res = await uploadDocumentContent(
      {
        filename: "CV.pdf",
        mimeType: "application/pdf",
        contentBase64: "@@",
      },
      "user-1",
    );

    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/invalid base64/i);
    expect(mockUploadFile).not.toHaveBeenCalled();
  });
});
