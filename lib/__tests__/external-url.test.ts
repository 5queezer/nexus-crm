/** @vitest-environment happy-dom */

import { afterEach, describe, expect, it, vi } from "vitest";
import { getSafeExternalUrl, openExternalUrl } from "../external-url";

const JAVASCRIPT_URL = ["java", "script:alert(1)"].join("");

describe("external URL policy", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    JAVASCRIPT_URL,
    "data:text/html,hello",
    "not a url",
    "",
  ])("rejects unsafe or invalid URL %s", (value) => {
    expect(getSafeExternalUrl(value)).toBeNull();
  });

  it.each([
    ["https://example.com/job", "https://example.com/job"],
    ["http://example.com/share", "http://example.com/share"],
  ])("allows HTTP(S) URL %s", (value, expected) => {
    expect(getSafeExternalUrl(value)).toBe(expected);
  });

  it("opens only validated destinations in a new isolated tab", () => {
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);

    expect(openExternalUrl(JAVASCRIPT_URL)).toBe(false);
    expect(click).not.toHaveBeenCalled();
    expect(openExternalUrl("https://example.com/job")).toBe(true);
    expect(click).toHaveBeenCalledOnce();
  });
});
