// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Application } from "@/types";
import { ApplicationDetail } from "../application-detail";

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string) => key,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/applications/application-1",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: { signOut: vi.fn() },
}));

function fixtureApplication(overrides: Partial<Application> = {}): Application {
  return {
    id: "application-1",
    company: "Acme",
    role: "Engineer",
    status: "applied",
    appliedAt: "2026-07-01T00:00:00.000Z",
    lastContact: null,
    followUpAt: null,
    notes: "Erste Notiz",
    jobDescription: null,
    source: "linkedin",
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
    contacts: [],
    ...overrides,
  };
}

function renderDetail(application: Application) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false } },
        })
      }
    >
      <ApplicationDetail
        user={{
          id: "user-1",
          name: "Chris",
          email: "chris@example.com",
          isAdmin: false,
        }}
        application={application}
      />
    </QueryClientProvider>,
  );
}

function notesTextarea(): HTMLTextAreaElement {
  return screen.getByPlaceholderText(
    "notes_placeholder",
  ) as HTMLTextAreaElement;
}

function saveButtons(): HTMLButtonElement[] {
  return screen.getAllByRole("button", { name: "save" }) as HTMLButtonElement[];
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ApplicationDetail", () => {
  it("renders the application values with a large auto-growing notes field", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => [] }) as Response),
    );
    renderDetail(fixtureApplication());

    expect(screen.getByDisplayValue("Acme")).toBeTruthy();
    expect(screen.getByDisplayValue("Engineer")).toBeTruthy();
    const notes = notesTextarea();
    expect(notes.value).toBe("Erste Notiz");
    expect(notes.className).toContain("field-sizing-content");
    expect(notes.className).toContain("min-h-64");
    expect(notes.className).toContain("resize-y");
    expect(notes.className).not.toContain("resize-none");
  });

  it("keeps saving disabled until the form is modified", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => [] }) as Response),
    );
    const user = userEvent.setup();
    renderDetail(fixtureApplication());

    expect(saveButtons().length).toBeGreaterThan(0);
    for (const button of saveButtons()) {
      expect(button.disabled).toBe(true);
    }

    await user.type(notesTextarea(), " ergänzt");

    for (const button of saveButtons()) {
      expect(button.disabled).toBe(false);
    }
  });

  it("sends expectedUpdatedAt and renews the baseline after each save", async () => {
    const patchBodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "PATCH") {
          const body = JSON.parse(String(init.body)) as Record<string, unknown>;
          patchBodies.push(body);
          return {
            ok: true,
            status: 200,
            json: async () => ({
              ...fixtureApplication(),
              notes: body.notes,
              updatedAt: `2026-07-0${patchBodies.length + 1}T00:00:00.000Z`,
            }),
          } as Response;
        }
        return { ok: true, json: async () => [] } as Response;
      }),
    );
    const user = userEvent.setup();
    renderDetail(fixtureApplication());

    await user.type(notesTextarea(), " v2");
    await user.click(saveButtons()[0]);

    await waitFor(() => expect(patchBodies.length).toBe(1));
    expect(patchBodies[0].expectedUpdatedAt).toBe("2026-07-01T00:00:00.000Z");
    expect(patchBodies[0].notes).toBe("Erste Notiz v2");

    // Baseline renewed: the form is clean again and the flash confirms saving.
    await waitFor(() => {
      for (const button of saveButtons()) {
        expect(button.disabled).toBe(true);
      }
    });
    expect(screen.getAllByText("saved").length).toBeGreaterThan(0);

    // A second save uses the renewed updatedAt — no 409 loop.
    await user.type(notesTextarea(), " v3");
    await user.click(saveButtons()[0]);
    await waitFor(() => expect(patchBodies.length).toBe(2));
    expect(patchBodies[1].expectedUpdatedAt).toBe("2026-07-02T00:00:00.000Z");
    expect(patchBodies[1].notes).toBe("Erste Notiz v2 v3");
  });

  it("shows a conflict banner on 409 and keeps the edits intact", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "PATCH") {
          return {
            ok: false,
            status: 409,
            json: async () => ({ error: "conflict" }),
          } as Response;
        }
        return { ok: true, json: async () => [] } as Response;
      }),
    );
    const user = userEvent.setup();
    renderDetail(fixtureApplication());

    await user.type(notesTextarea(), " wichtig");
    await user.click(saveButtons()[0]);

    await screen.findByText("error_conflict");
    expect(notesTextarea().value).toBe("Erste Notiz wichtig");
    // The form stays dirty so the user can retry or reload deliberately.
    expect(saveButtons()[0].disabled).toBe(false);
  });
});
