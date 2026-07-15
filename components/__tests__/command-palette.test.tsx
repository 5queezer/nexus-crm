// @vitest-environment happy-dom

import { render } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Application } from "@/types";
import { CommandPalette } from "../command-palette";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

function application(id: string, company: string, updatedAt: string): Application {
  return {
    id,
    company,
    role: "Engineer",
    status: "applied",
    appliedAt: null,
    lastContact: null,
    followUpAt: null,
    notes: null,
    jobDescription: null,
    source: null,
    remote: false,
    salaryMin: null,
    salaryMax: null,
    rating: null,
    jobUrl: null,
    resumeId: null,
    companySize: null,
    salaryBandMentioned: false,
    triageQuality: null,
    triageReason: null,
    incomingSource: null,
    autoRejected: false,
    autoRejectReason: null,
    archivedAt: null,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt,
  };
}

describe("CommandPalette ordering", () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("orders by one deterministic timestamp projection without mutating applications", () => {
    const applications = [
      application("old", "Old", "2026-07-01T00:00:00.000Z"),
      application("new", "New", "2026-07-15T00:00:00.000Z"),
      application("invalid-b", "Invalid B", "not-a-date"),
      application("invalid-a", "Invalid A", "also-invalid"),
    ];
    const originalOrder = applications.map((item) => item.id);

    const { container } = render(
      <CommandPalette
        applications={applications}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(applications.map((item) => item.id)).toEqual(originalOrder);
    expect(
      Array.from(container.querySelectorAll<HTMLButtonElement>("button[data-index]"))
        .map((button) => button.textContent)
        .map((text) => text?.match(/^(New|Old|Invalid A|Invalid B)/)?.[0]),
    ).toEqual(["New", "Old", "Invalid A", "Invalid B"]);
  });
});
