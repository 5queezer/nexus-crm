// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Application } from "@/types";
import { ApplicationModal } from "../application-modal";

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string) => key,
}));

function application(resumeId: string | null): Application {
  return {
    id: "application-1",
    company: "Acme",
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
    resumeId,
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

function renderModal(resumeId: string | null) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false } },
        })
      }
    >
      <ApplicationModal application={application(resumeId)} onClose={vi.fn()} />
    </QueryClientProvider>,
  );
}

describe("ApplicationModal tailored resume identity", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "requestAnimationFrame",
      (callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.replaceChildren();
    document.body.style.overflow = "";
  });

  it("switches from tailor to resume state immediately after creating a resume", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/documents")) {
        return { ok: true, json: async () => [] } as Response;
      }
      expect(init?.method).toBe("POST");
      return {
        ok: true,
        status: 200,
        json: async () => ({
          resumeId: "resume-new",
          editUrl: "https://resume.example/edit/resume-new",
        }),
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    const user = userEvent.setup();
    renderModal(null);

    await user.click(screen.getByRole("button", { name: "resume_section" }));
    await user.click(screen.getByRole("button", { name: "resume_tailor" }));

    const open = await screen.findByRole("button", { name: "resume_open" });
    expect(screen.queryByRole("button", { name: "resume_tailor" })).toBeNull();
    await user.click(open);
    expect(click).toHaveBeenCalledOnce();
  });

  it("preserves the returned edit URL for an existing resume in the mounted modal", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/documents")) {
        return { ok: true, json: async () => [] } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          resumeId: "resume-existing",
          editUrl: "https://resume.example/edit/resume-existing",
        }),
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderModal("resume-existing");

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([input]) => String(input).endsWith("/tailor"),
        ),
      ).toBe(true),
    );
    await user.click(screen.getByRole("button", { name: "resume_section" }));
    const open = await screen.findByRole("button", { name: "resume_open" });
    expect(open.hasAttribute("disabled")).toBe(false);
  });
});
