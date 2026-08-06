import { describe, expect, it } from "vitest";
import { applicationPath, applicationSlug, isSafeApplicationId } from "../slug";

describe("applicationSlug", () => {
  it("builds the requested readable slug and removes audience suffixes", () => {
    expect(applicationSlug("Hygraph", "Senior Fullstack Engineer (f/m/d)"))
      .toBe("hygraph-senior-fullstack-engineer");
  });

  it("transliterates umlauts, sharp S variants, and special characters", () => {
    expect(applicationSlug("Münchner Rück", "Entwickler:in & Platform"))
      .toBe("muenchner-rueck-entwickler-in-and-platform");
    expect(applicationSlug("Groẞhandel", "Engineer")).toBe("grosshandel-engineer");
  });

  it("collapses repeated separators and trims their edges", () => {
    expect(applicationSlug("-- Acme / GmbH --", "  Senior --- Engineer  "))
      .toBe("acme-gmbh-senior-engineer");
  });

  it("uses a stable fallback for empty values", () => {
    expect(applicationSlug("", "")).toBe("application");
    expect(applicationSlug(null, undefined)).toBe("application");
  });

  it("enforces the maximum length without a trailing dash", () => {
    const slug = applicationSlug("A".repeat(100), "B".repeat(100));
    expect(slug.length).toBeLessThanOrEqual(96);
    expect(slug).not.toMatch(/-$/);
  });
});

describe("isSafeApplicationId", () => {
  it("accepts adapter-compatible IDs and rejects malformed route values", () => {
    expect(isSafeApplicationId("106")).toBe(true);
    expect(isSafeApplicationId("firestore_ID-1")).toBe(true);
    expect(isSafeApplicationId("../secret")).toBe(false);
    expect(isSafeApplicationId("x".repeat(129))).toBe(false);
  });
});

describe("applicationPath", () => {
  it("keeps the ID as identity and adds the readable slug", () => {
    expect(applicationPath({
      id: "106",
      company: "Hygraph",
      role: "Senior Fullstack Engineer (f/m/d)",
    })).toBe("/applications/106/hygraph-senior-fullstack-engineer");
  });
});
