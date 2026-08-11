import { beforeEach, describe, expect, it, vi } from "vitest";

const deleteFile = vi.hoisted(() => vi.fn());

vi.mock("@/lib/storage", () => ({ deleteFile }));

import { deleteDocumentWithContent } from "../service";

const guard = { requireNonDemoProvenance: true } as const;

function adapter(deleteDocument: ReturnType<typeof vi.fn>) {
  return { deleteDocument } as never;
}

describe("deleteDocumentWithContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not delete content when the transactional provenance guard rejects", async () => {
    const deleteDocument = vi.fn().mockRejectedValue(new Error("not_found"));

    await expect(
      deleteDocumentWithContent(adapter(deleteDocument), "doc-1", "owner-1", guard),
    ).rejects.toThrow("not_found");

    expect(deleteDocument).toHaveBeenCalledWith("doc-1", "owner-1", guard);
    expect(deleteFile).not.toHaveBeenCalled();
  });

  it("does not delete content when document metadata is absent", async () => {
    const deleteDocument = vi.fn().mockResolvedValue(null);

    await expect(
      deleteDocumentWithContent(adapter(deleteDocument), "doc-1", "owner-1", guard),
    ).resolves.toBeNull();

    expect(deleteFile).not.toHaveBeenCalled();
  });

  it("deletes content only after guarded metadata deletion succeeds", async () => {
    const document = { id: "doc-1", filename: "stored.pdf" };
    const deleteDocument = vi.fn().mockResolvedValue(document);

    await expect(
      deleteDocumentWithContent(adapter(deleteDocument), "doc-1", "owner-1", guard),
    ).resolves.toBe(document);

    expect(deleteDocument).toHaveBeenCalledWith("doc-1", "owner-1", guard);
    expect(deleteFile).toHaveBeenCalledWith("stored.pdf");
    expect(deleteDocument.mock.invocationCallOrder[0]).toBeLessThan(
      deleteFile.mock.invocationCallOrder[0],
    );
  });

  it("propagates storage cleanup failures without repeating metadata deletion", async () => {
    const deleteDocument = vi.fn().mockResolvedValue({ id: "doc-1", filename: "stored.pdf" });
    deleteFile.mockRejectedValue(new Error("storage_failed"));

    await expect(
      deleteDocumentWithContent(adapter(deleteDocument), "doc-1", "owner-1", guard),
    ).rejects.toThrow("storage_failed");

    expect(deleteDocument).toHaveBeenCalledTimes(1);
  });
});
