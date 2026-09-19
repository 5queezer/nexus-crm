/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseWorkspaceUrl, subscribeWorkspaceUrl, writeWorkspaceUrl } from "../workspace-url";
describe("workspace URL", () => {
  beforeEach(() => window.history.replaceState(null, "", "/?source=linkedin"));
  afterEach(() => vi.restoreAllMocks());
  it("restores all filters, archive scope and view", () => {
    expect(parseWorkspaceUrl("?view=kanban&archive=true&status=offer&remote=true&priority=true&search=Acme&source=linkedin")).toEqual({ view: "kanban", archived: true, filters: { status: "offer", remoteOnly: true, highPriorityOnly: true, search: "Acme", source: "linkedin" } });
  });
  it("discards unknown statuses and views", () => {
    const result = parseWorkspaceUrl("?view=unsafe&status=deleted");
    expect(result.view).toBeNull(); expect(result.filters.status).toBe("");
  });
  it("keeps deliberate view navigation in history while replacing live filters", () => {
    const push = vi.spyOn(window.history, "pushState");
    const replace = vi.spyOn(window.history, "replaceState");
    const notify = vi.fn();
    const unsubscribe = subscribeWorkspaceUrl(notify);
    try {
      writeWorkspaceUrl({ view: "kanban" });
      for (const search of ["A", "Ac", "Acme"]) writeWorkspaceUrl({ search }, "replace");
      expect(push).toHaveBeenCalledTimes(1);
      expect(replace).toHaveBeenCalledTimes(3);
      expect(notify).toHaveBeenCalledTimes(4);
      expect(parseWorkspaceUrl(window.location.search)).toMatchObject({ view: "kanban", filters: { search: "Acme", source: "linkedin" } });
      writeWorkspaceUrl({ search: "Acme" }, "replace");
      expect(notify).toHaveBeenCalledTimes(4);
    } finally { unsubscribe(); }
  });
});
