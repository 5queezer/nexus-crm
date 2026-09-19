import { describe, expect, it } from "vitest";
import { parseWorkspaceUrl } from "../workspace-url";
describe("workspace URL", () => {
  it("restores all filters, archive scope and view", () => {
    expect(parseWorkspaceUrl("?view=kanban&archive=true&status=offer&remote=true&priority=true&search=Acme&source=linkedin")).toEqual({ view: "kanban", archived: true, filters: { status: "offer", remoteOnly: true, highPriorityOnly: true, search: "Acme", source: "linkedin" } });
  });
  it("discards unknown statuses and views", () => {
    const result = parseWorkspaceUrl("?view=unsafe&status=deleted");
    expect(result.view).toBeNull(); expect(result.filters.status).toBe("");
  });
});
