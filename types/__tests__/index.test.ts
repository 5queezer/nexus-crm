import { describe, it, expect } from "vitest";
import {
  normalizeStatus,
  normalizeSource,
  STATUS_ORDER,
  STATUS_COLORS,
  STATUS_ROW_COLORS,
  SOURCE_PRESETS,
} from "../index";

describe("normalizeStatus", () => {
  it("returns valid statuses unchanged", () => {
    for (const status of STATUS_ORDER) {
      expect(normalizeStatus(status)).toBe(status);
    }
  });

  it("normalizes case", () => {
    expect(normalizeStatus("APPLIED")).toBe("applied");
    expect(normalizeStatus("Interview")).toBe("interview");
    expect(normalizeStatus("OFFER")).toBe("offer");
  });

  it("trims whitespace", () => {
    expect(normalizeStatus("  applied  ")).toBe("applied");
    expect(normalizeStatus("\trejected\n")).toBe("rejected");
  });

  it("maps 'waiting' alias to 'applied'", () => {
    expect(normalizeStatus("waiting")).toBe("applied");
  });

  it("maps 'draft' alias to 'applied'", () => {
    expect(normalizeStatus("draft")).toBe("applied");
  });

  it("maps 'ghost' alias to 'rejected'", () => {
    expect(normalizeStatus("ghost")).toBe("rejected");
  });

  it("defaults unknown values to 'applied'", () => {
    expect(normalizeStatus("unknown")).toBe("applied");
    expect(normalizeStatus("foobar")).toBe("applied");
  });

  it("handles null input", () => {
    expect(normalizeStatus(null)).toBe("applied");
  });

  it("handles undefined input", () => {
    expect(normalizeStatus(undefined)).toBe("applied");
  });

  it("handles empty string", () => {
    expect(normalizeStatus("")).toBe("applied");
  });
});

describe("STATUS_ORDER", () => {
  it("contains exactly 5 statuses", () => {
    expect(STATUS_ORDER).toHaveLength(5);
  });

  it("starts with inbound and ends with rejected", () => {
    expect(STATUS_ORDER[0]).toBe("inbound");
    expect(STATUS_ORDER[STATUS_ORDER.length - 1]).toBe("rejected");
  });
});

describe("STATUS_COLORS", () => {
  it("has a color entry for every status", () => {
    for (const status of STATUS_ORDER) {
      expect(STATUS_COLORS[status]).toBeDefined();
      expect(typeof STATUS_COLORS[status]).toBe("string");
    }
  });
});

describe("STATUS_ROW_COLORS", () => {
  it("has an entry for every status", () => {
    for (const status of STATUS_ORDER) {
      expect(STATUS_ROW_COLORS[status]).toBeDefined();
    }
  });
});

describe("normalizeSource", () => {
  it("returns presets unchanged", () => {
    expect(normalizeSource("linkedin")).toBe("linkedin");
    expect(normalizeSource("referral")).toBe("referral");
  });

  it("maps aliases to presets", () => {
    expect(normalizeSource("Webseite")).toBe("website");
    expect(normalizeSource("Empfehlung")).toBe("referral");
  });

  it("strips a leading ISO date stamp", () => {
    expect(normalizeSource("2026-07-07 Himalayas")).toBe("Himalayas");
    expect(normalizeSource("2026-07-07 LinkedIn")).toBe("linkedin");
  });

  it("strips a leading European date stamp", () => {
    expect(normalizeSource("07.07.2026 Himalayas")).toBe("Himalayas");
  });

  it("strips a leading label prefix", () => {
    expect(normalizeSource("MCP scan: Himalayas")).toBe("Himalayas");
  });

  it("strips trailing semicolon-separated notes", () => {
    expect(normalizeSource("Himalayas; canonical source pending")).toBe("Himalayas");
  });

  it("strips combined date, label, and note metadata", () => {
    expect(
      normalizeSource("2026-07-07 MCP scan: Himalayas + web search; canonical source pending")
    ).toBe("Himalayas + web search");
  });

  it("returns null when only metadata remains", () => {
    expect(normalizeSource("2026-07-07")).toBe(null);
    expect(normalizeSource("2026-07-07; pending")).toBe(null);
  });

  it("leaves URLs untouched", () => {
    expect(normalizeSource("https://example.com/jobs;id=1")).toBe("https://example.com/jobs;id=1");
  });

  it("maps bare domains to website", () => {
    expect(normalizeSource("example.com")).toBe("website");
  });

  it("handles null, undefined, and empty input", () => {
    expect(normalizeSource(null)).toBe(null);
    expect(normalizeSource(undefined)).toBe(null);
    expect(normalizeSource("   ")).toBe(null);
  });
});

describe("SOURCE_PRESETS", () => {
  it("contains expected preset values", () => {
    expect(SOURCE_PRESETS).toContain("linkedin");
    expect(SOURCE_PRESETS).toContain("referral");
    expect(SOURCE_PRESETS).toContain("website");
  });
});
