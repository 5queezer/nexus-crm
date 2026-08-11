import { describe, expect, it } from "vitest";
import { safeInternalCallbackURL } from "../login-callback";

describe("safeInternalCallbackURL", () => {
  it("keeps an internal application route including query and hash", () => {
    expect(safeInternalCallbackURL("/applications/hygraph-engineer?tab=timeline#event-2"))
      .toBe("/applications/hygraph-engineer?tab=timeline#event-2");
  });

  it.each([
    "https://evil.example/steal",
    "//evil.example/steal",
    "\\\\evil.example\\steal",
    "javascript:alert(1)",
    "/\\evil.example",
    "/%2f%2fevil.example/path",
    "/%252f%252fevil.example/path",
    "https:%2f%2fevil.example",
  ])("rejects external or ambiguous callback %s", (callback) => {
    expect(safeInternalCallbackURL(callback)).toBe("/");
  });

  it("fails closed for payloads nested beyond the decoding limit", () => {
    let payload = "//evil.example/path";
    for (let pass = 0; pass < 10; pass += 1) payload = encodeURIComponent(payload);
    expect(safeInternalCallbackURL(`/${payload}`)).toBe("/");
  });

  it("falls back for missing and malformed values", () => {
    expect(safeInternalCallbackURL(null)).toBe("/");
    expect(safeInternalCallbackURL("not-a-path")).toBe("/");
    expect(safeInternalCallbackURL("/%E0%A4%A")).toBe("/");
  });
});
