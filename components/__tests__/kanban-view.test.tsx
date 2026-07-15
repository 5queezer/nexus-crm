// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Application } from "../../types";
import { KanbanView } from "../kanban-view";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

const opportunity: Application = {
  id: "application-1",
  company: "Nexus",
  role: "Engineer",
  status: "interview",
  appliedAt: "2026-07-01T00:00:00.000Z",
  lastContact: null,
  followUpAt: null,
  notes: null,
  jobDescription: null,
  source: "linkedin",
  remote: true,
  salaryMin: null,
  salaryMax: null,
  rating: 5,
  jobUrl: "https://example.com/job",
  resumeId: null,
  companySize: null,
  salaryBandMentioned: false,
  triageQuality: 5,
  triageReason: null,
  incomingSource: null,
  autoRejected: false,
  autoRejectReason: null,
  archivedAt: null,
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
};

describe("KanbanView compact controls", () => {
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

  it("gives the job link an accessible 48px target", async () => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <KanbanView applications={[opportunity]} onEdit={vi.fn()} />
        </QueryClientProvider>,
      );
    });

    const links = Array.from(
      container.querySelectorAll<HTMLButtonElement>(
        'button[aria-label="open_job_post"]',
      ),
    );
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link.className).toContain("nexus-target");
    }
  });
});
