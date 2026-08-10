import { describe, expect, it } from "vitest";
import { realApplications } from "../presentation";

const app = (id: string, isDemo: boolean) => ({ id, isDemo });

describe("demo presentation statistics", () => {
  it("returns zero real rows for a demo-only workspace", () => {
    expect(realApplications([app("demo", true)])).toEqual([]);
  });

  it("keeps only real and legacy unmarked rows in a mixed workspace", () => {
    const legacy = { id: "legacy", isDemo: undefined };
    expect(realApplications([app("demo", true), app("real", false), legacy])).toEqual([app("real", false), legacy]);
  });
});
