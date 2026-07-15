import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceToolbar } from "../workspace-toolbar";

describe("WorkspaceToolbar", () => {
  it("keeps all three views direct and the expanded create action singular", () => {
    const html = renderToStaticMarkup(
      <WorkspaceToolbar
        title="Opportunities"
        count={22}
        viewMode="focus"
        onViewModeChange={vi.fn()}
        moreMenu={<button type="button">More</button>}
        onCreate={vi.fn()}
        createLabel="New Opportunity"
        focusLabel="Focus"
        tableLabel="Table"
        kanbanLabel="Kanban"
        listLabel="List"
        stagesLabel="Stages"
      />,
    );

    expect(html).toContain("Opportunities");
    expect(html).toContain("(22)");
    expect(html).toContain("Focus");
    expect(html).toContain("List");
    expect(html).toContain("Stages");
    expect(html).toContain("Table");
    expect(html).toContain("Kanban");
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("min-h-12");
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="Focus / Table / Kanban"');
    expect(html.match(/New Opportunity/g) ?? []).toHaveLength(1);
  });
});
