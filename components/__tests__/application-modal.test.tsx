import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { JobUrlField } from "../application-form/job-url-field";

describe("JobUrlField", () => {
  it("renders an existing job link as a touch-sized open control with an edit button", () => {
    const html = renderToStaticMarkup(
      <JobUrlField
        value="https://example.com/job"
        onChange={vi.fn()}
        label="Listing Link"
        placeholder="https://..."
        editLabel="Edit"
        saveLabel="Save"
      />,
    );

    expect(html).toContain('title="https://example.com/job"');
    expect(html).toContain('type="button"');
    expect(html).toContain("nexus-target");
    expect(html).toContain(">Edit</button>");
  });

  it("renders an editable URL input when no job link exists", () => {
    const html = renderToStaticMarkup(
      <JobUrlField
        value=""
        onChange={vi.fn()}
        label="Listing Link"
        placeholder="https://..."
        editLabel="Edit"
        saveLabel="Save"
      />,
    );

    expect(html).toContain('type="url"');
    expect(html).toContain('name="jobUrl"');
    expect(html).toContain('placeholder="https://..."');
  });
});
