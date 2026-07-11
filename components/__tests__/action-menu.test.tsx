import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ActionMenu } from "../action-menu";

describe("ActionMenu", () => {
  it("renders one accessible trigger and keeps actions progressively disclosed", () => {
    const html = renderToStaticMarkup(
      <ActionMenu
        label="Actions for OpenAI"
        items={[
          { id: "edit", label: "Edit", onSelect: vi.fn() },
          { id: "delete", label: "Delete", destructive: true, onSelect: vi.fn() },
        ]}
      />,
    );

    expect(html).toContain('aria-label="Actions for OpenAI"');
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('role="menu"');
    expect(html).not.toContain(">Edit<");
    expect(html).not.toContain(">Delete<");
  });

  it("supports a labeled workspace utility trigger", () => {
    const html = renderToStaticMarkup(
      <ActionMenu label="More actions" buttonText="More" items={[]} />,
    );

    expect(html).toContain('aria-label="More actions"');
    expect(html).toContain(">More<");
  });
});
