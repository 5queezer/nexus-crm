// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Application } from "@/types";
import { FocusQueue } from "../focus-queue";

const opportunity: Application = {
  id: "a",
  company: "Acme",
  role: "Engineer",
  status: "inbound",
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
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string) => key,
}));

describe("FocusQueue empty recovery", () => {
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

  it("shows a visible, named 48px status control in compact rows", async () => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <FocusQueue
            applications={[opportunity]}
            isTrueEmpty={false}
            isFilteredEmpty={false}
            selectedIds={new Set()}
            onToggleSelect={vi.fn()}
            onOpen={vi.fn()}
            onEdit={vi.fn()}
            onDelete={vi.fn()}
            onArchive={vi.fn()}
            onCreate={vi.fn()}
            onClearFilters={vi.fn()}
          />
        </QueryClientProvider>,
      );
    });

    const statusControl = container.querySelector<HTMLSelectElement>("select");
    expect(statusControl?.getAttribute("aria-label")).toBe("change_status");
    expect(statusControl?.className).toContain("h-12");
    expect(statusControl?.className).toContain("text-slate-700");
    expect(statusControl?.className).not.toContain("text-transparent");
    expect(statusControl?.selectedOptions[0]?.textContent).toBe("inbound");
  });

  it("renders one explicit create recovery for a true-empty workspace", async () => {
    const onCreate = vi.fn();
    await act(async () => {
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <FocusQueue
            applications={[]}
            isTrueEmpty
            isFilteredEmpty={false}
            selectedIds={new Set()}
            onToggleSelect={vi.fn()}
            onOpen={vi.fn()}
            onEdit={vi.fn()}
            onDelete={vi.fn()}
            onArchive={vi.fn()}
            onCreate={onCreate}
            onClearFilters={vi.fn()}
          />
        </QueryClientProvider>,
      );
    });

    const button = container.querySelector("button");
    expect(button?.textContent).toBe("create");
    await act(async () => button?.click());
    expect(onCreate).toHaveBeenCalledOnce();
    expect(container.textContent).not.toContain("groups.overdue");
  });
});
