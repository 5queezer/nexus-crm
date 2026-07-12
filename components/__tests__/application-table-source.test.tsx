import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import en from "../../messages/en.json";
import { ApplicationTable } from "../application-table";
import type { Application } from "@/types";

const application: Application = {
  id: "app-1",
  company: "Example",
  role: "Engineer",
  status: "applied",
  appliedAt: null,
  lastContact: null,
  followUpAt: null,
  notes: null,
  jobDescription: null,
  source: "2026-07-07 MCP scan: Himalayas + web search; canonical source pending",
  remote: true,
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
  createdAt: "2026-07-07T00:00:00.000Z",
  updatedAt: "2026-07-07T00:00:00.000Z",
};

describe("ApplicationTable source column", () => {
  it("shows the normalized category and retains raw provenance in the tooltip", () => {
    const html = renderToStaticMarkup(
      <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
        <ApplicationTable
          applications={[application]}
          onEdit={vi.fn()}
          onDelete={vi.fn()}
        />
      </NextIntlClientProvider>,
    );

    expect(html).toContain(">Himalayas<");
    expect(html).toContain(`title="${application.source}"`);
    expect(html).not.toContain(">2026-07-07 MCP scan:");
  });
});
