import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@google-cloud/storage", () => ({
  Storage: vi.fn(() => {
    throw new Error("GCS should not be initialized");
  }),
}));

const originalEnv = { ...process.env };
const tempDirs: string[] = [];

async function importFreshStorage() {
  vi.resetModules();
  return import("../storage");
}

describe("storage backend selection", () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(async () => {
    process.env = { ...originalEnv };
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("falls back to local storage when explicit GCS credentials file is missing", async () => {
    const uploadDir = await mkdtemp(path.join(tmpdir(), "nexus-storage-"));
    tempDirs.push(uploadDir);

    process.env.GCS_BUCKET = "configured-bucket";
    process.env.GOOGLE_APPLICATION_CREDENTIALS = path.join(uploadDir, "missing-key.json");
    process.env.UPLOAD_DIR = uploadDir;

    const { uploadFile, isGcsBacked } = await importFreshStorage();

    await uploadFile("doc.pdf", Buffer.from("pdf bytes"), "application/pdf");

    expect(isGcsBacked()).toBe(false);
    await expect(readFile(path.join(uploadDir, "doc.pdf"), "utf8")).resolves.toBe("pdf bytes");
  });

  it.each(["", ".", "..", "../outside.pdf", "/tmp/outside.pdf", "nested/outside.pdf", "nested\\outside.pdf", "bad\0name.pdf"])(
    "rejects unsafe storage object names before touching the filesystem: %s",
    async (filename) => {
      const uploadDir = await mkdtemp(path.join(tmpdir(), "nexus-storage-"));
      tempDirs.push(uploadDir);
      process.env.UPLOAD_DIR = uploadDir;
      delete process.env.GCS_BUCKET;

      const { uploadFile, downloadFile, deleteFile, fileExists, getSignedDownloadUrl } = await importFreshStorage();

      await expect(uploadFile(filename, Buffer.from("secret"), "application/pdf")).rejects.toThrow(
        "Invalid storage object name",
      );
      await expect(downloadFile(filename)).rejects.toThrow("Invalid storage object name");
      await expect(deleteFile(filename)).rejects.toThrow("Invalid storage object name");
      await expect(fileExists(filename)).rejects.toThrow("Invalid storage object name");
      await expect(getSignedDownloadUrl(filename)).rejects.toThrow("Invalid storage object name");
    },
  );
});
