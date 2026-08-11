// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Application } from "@/types";
import { OverdueFollowUpsBanner } from "../overdue-followups-banner";

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string) => key,
}));

function overdue(id: string, company: string): Application {
  return {
    id,
    company,
    role: "Engineer",
    status: "interview",
    appliedAt: null,
    lastContact: null,
    followUpAt: "2020-01-01",
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
    updatedAt: "2026-07-01T00:00:00.000Z",
  };
}

describe("OverdueFollowUpsBanner", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
  });

  async function render(applications: Application[]) {
    const props = {
      applications,
      onOpen: vi.fn(),
      onDismiss: vi.fn(),
      onDismissAll: vi.fn(),
    };
    await act(async () => {
      root.render(<OverdueFollowUpsBanner {...props} />);
    });
    return props;
  }

  it("renders nothing without overdue follow-ups", async () => {
    await render([]);
    expect(container.textContent).toBe("");
  });

  it("summarises many follow-ups into a single collapsed row", async () => {
    await render([
      overdue("a", "Bending Spoons"),
      overdue("b", "Quadrivia"),
      overdue("c", "Pearson"),
    ]);

    const toggle = container.querySelector<HTMLButtonElement>(
      "button[aria-expanded]",
    );
    const detailsId = toggle?.getAttribute("aria-controls");

    expect(container.textContent).toContain("overdue_summary");
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
    expect(detailsId).toBeTruthy();
    expect(document.getElementById(detailsId!)).toBeNull();
    expect(container.textContent).not.toContain("Bending Spoons");
  });

  it("uses the singular summary for a single follow-up", async () => {
    await render([overdue("a", "Bending Spoons")]);
    expect(container.textContent).toContain("overdue_summary_one");
  });

  it("reveals the companies when expanded", async () => {
    const props = await render([
      overdue("a", "Bending Spoons"),
      overdue("b", "Quadrivia"),
    ]);

    const toggle = container.querySelector<HTMLButtonElement>(
      "button[aria-expanded]",
    );
    await act(async () => toggle?.click());

    const details = document.getElementById(
      toggle!.getAttribute("aria-controls")!,
    );
    expect(toggle?.getAttribute("aria-expanded")).toBe("true");
    expect(details?.textContent).toContain("Bending Spoons");
    expect(details?.textContent).toContain("Quadrivia");

    const companyButton = Array.from(
      details!.querySelectorAll("button"),
    ).find((button) => button.textContent === "Quadrivia");
    await act(async () => companyButton?.click());
    expect(props.onOpen).toHaveBeenCalledWith(
      expect.objectContaining({ id: "b" }),
    );
  });

  it("dismisses a single entry from the expanded list", async () => {
    const props = await render([
      overdue("a", "Bending Spoons"),
      overdue("b", "Quadrivia"),
    ]);

    await act(async () =>
      container
        .querySelector<HTMLButtonElement>("button[aria-expanded]")
        ?.click(),
    );
    const dismissButtons = container.querySelectorAll<HTMLButtonElement>(
      'button[aria-label="dismiss_overdue"]',
    );
    expect(dismissButtons.length).toBe(2);

    await act(async () => dismissButtons[0].click());
    expect(props.onDismiss).toHaveBeenCalledWith(
      expect.objectContaining({ id: "a" }),
    );
  });

  it("gives every interactive control the shared 48px target", async () => {
    await render([overdue("a", "Bending Spoons"), overdue("b", "Quadrivia")]);

    const toggle = container.querySelector<HTMLButtonElement>(
      "button[aria-expanded]",
    );
    expect(toggle?.className).toContain("nexus-target");
    expect(
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="dismiss_all_overdue"]',
      )?.className,
    ).toContain("nexus-target");

    await act(async () => toggle?.click());

    // Per-entry controls must not shrink below the shared minimum either.
    const perEntry = container.querySelectorAll<HTMLButtonElement>(
      `#${CSS.escape(toggle!.getAttribute("aria-controls")!)} button`,
    );
    expect(perEntry.length).toBe(4);
    for (const button of perEntry) {
      expect(button.className).toContain("nexus-target");
    }
  });

  it("dismisses every entry from the collapsed row", async () => {
    const applications = [overdue("a", "Bending Spoons"), overdue("b", "Quadrivia")];
    const props = await render(applications);

    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="dismiss_all_overdue"]',
        )
        ?.click(),
    );
    expect(props.onDismissAll).toHaveBeenCalledWith(applications);
  });
});
