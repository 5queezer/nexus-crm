import { describe, expect, it } from "vitest";
import { resolveOpportunityView } from "@/lib/applications/workspace-view";

describe("responsive opportunities view resolution", () => {
  it("defaults untouched compact sessions to Focus and expanded sessions to Table", () => {
    expect(resolveOpportunityView(null, true, false)).toBe("focus");
    expect(resolveOpportunityView(null, false, false)).toBe("table");
  });

  it("preserves explicit selection across resize", () => {
    expect(resolveOpportunityView("kanban", true, false)).toBe("kanban");
    expect(resolveOpportunityView("kanban", false, false)).toBe("kanban");
    expect(resolveOpportunityView("table", true, false)).toBe("table");
  });

  it("never resolves archive to Focus but preserves supported explicit views", () => {
    expect(resolveOpportunityView(null, true, true)).toBe("table");
    expect(resolveOpportunityView("focus", true, true)).toBe("table");
    expect(resolveOpportunityView("table", true, true)).toBe("table");
    expect(resolveOpportunityView("kanban", false, true)).toBe("kanban");
  });

  it("restores every explicit choice in the active workspace", () => {
    expect(resolveOpportunityView("focus", true, false)).toBe("focus");
    expect(resolveOpportunityView("table", true, false)).toBe("table");
    expect(resolveOpportunityView("kanban", true, false)).toBe("kanban");
  });
});
