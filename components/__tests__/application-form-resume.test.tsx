// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DocumentsSection } from "../application-form/documents-section";
import { ResumeSection } from "../application-form/resume-section";

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string) => key,
}));

function renderSections(resumeId: string | null) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false } },
        })
      }
    >
      <DocumentsSection applicationId="application-1" resumeId={resumeId} />
      <ResumeSection applicationId="application-1" resumeId={resumeId} />
    </QueryClientProvider>,
  );
}

describe("Application form resume sections", () => {
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
    renderSections(null);

    await user.click(screen.getByRole("button", { name: "resume_section" }));
    await user.click(screen.getByRole("button", { name: "resume_tailor" }));

    const open = await screen.findByRole("button", { name: "resume_open" });
    expect(screen.queryByRole("button", { name: "resume_tailor" })).toBeNull();
    await user.click(open);
    expect(click).toHaveBeenCalledOnce();
  });

  it("preserves the returned edit URL for an existing resume in the mounted section", async () => {
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
    renderSections("resume-existing");

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

  it("shows a linked Reactive Resume as a document file type", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
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
      }),
    );
    const user = userEvent.setup();
    renderSections("resume-existing");

    await user.click(screen.getByRole("button", { name: /documents_section/ }));

    const link = await screen.findByRole("link", { name: "documents_open_resume" });
    expect(link.getAttribute("href")).toBe(
      "/api/applications/application-1/resume",
    );
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(screen.getByText("documents_reactive_resume")).toBeTruthy();
    expect(screen.getByText("documents_external_link")).toBeTruthy();
  });
});
