import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceToolbar } from "../workspace-toolbar";

describe("WorkspaceToolbar", () => {
  it("groups the workspace title, views, overflow, and primary action", () => {
    const html = renderToStaticMarkup(
      <WorkspaceToolbar
        title="Opportunities"
        count={22}
        viewMode="table"
        onViewModeChange={vi.fn()}
        moreMenu={<button type="button">More</button>}
        onCreate={vi.fn()}
        createLabel="New Opportunity"
        tableLabel="Table"
        kanbanLabel="Kanban"
      />,
    );

    expect(html).toContain("Opportunities (22)");
    expect(html.indexOf("Table")).toBeLessThan(html.indexOf("More"));
    expect(html.indexOf("More")).toBeLessThan(html.indexOf("New Opportunity"));
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("min-h-10");
    expect(html).toContain("col-span-2");
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="Table / Kanban"');
  });
});
