import { describe, expect, it, vi } from "vitest";
import { sanitizeDocumentAssociations } from "../provenance";

describe("sanitizeDocumentAssociations durable demo provenance", () => {
  it("rejects a detached document that previously had demo provenance", async () => {
    const resolve = vi.fn();

    const result = await sanitizeDocumentAssociations({
      id: "doc-1",
      demoProvenance: true,
      applicationIds: [],
      applications: [],
    }, resolve);

    expect(result).toBeNull();
    expect(resolve).not.toHaveBeenCalled();
  });

  it("keeps a confirmed real association while stripping internal provenance", async () => {
    const result = await sanitizeDocumentAssociations({
      id: "doc-1",
      demoProvenance: true,
      applicationIds: ["real-app"],
      applications: [{ id: "real-app" }],
    }, async () => ({ id: "real-app" }));

    expect(result).toEqual({ id: "doc-1", applications: [{ id: "real-app" }] });
  });
});
