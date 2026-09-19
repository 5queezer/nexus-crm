// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Application } from "@/types";
import { authClient } from "@/lib/auth-client";
import { ApplicationDetail } from "../application-detail";

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string) => key,
}));

const navigationMocks = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }));

vi.mock("next/navigation", () => ({
  usePathname: () => "/applications/application-1/acme-engineer",
  useSearchParams: () => new URLSearchParams(window.location.search),
  useRouter: () => navigationMocks,
}));

// Render links as plain anchors so navigation clicks stay observable in the
// test environment without pulling in the app router.
vi.mock("next/link", () => ({
  __esModule: true,
  default: (
    props: { href: string; children?: ReactNode } & AnchorHTMLAttributes<HTMLAnchorElement>,
  ) => {
    const { href, children, ...rest } = props;
    return (
      <a href={href} {...rest}>
        {children}
      </a>
    );
  },
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
    nextAction: null,
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
        canonicalPath="/applications/application-1/acme-engineer"
      />
    </QueryClientProvider>,
  );
}

async function openEditor(user: ReturnType<typeof userEvent.setup>) {
  // The hero and the mobile action bar both offer it; either opens the editor.
  await user.click(screen.getAllByRole("button", { name: "edit" })[0]);
}

async function openTab(
  user: ReturnType<typeof userEvent.setup>,
  name: string,
) {
  await user.click(screen.getByRole("tab", { name }));
}

function notesTextarea(): HTMLTextAreaElement {
  return screen.getByPlaceholderText(
    "notes_placeholder",
  ) as HTMLTextAreaElement;
}

function cancelButtons(): HTMLButtonElement[] {
  return screen.getAllByRole("button", { name: "cancel" }) as HTMLButtonElement[];
}

function saveButtons(): HTMLButtonElement[] {
  return screen.getAllByRole("button", { name: "save" }) as HTMLButtonElement[];
}

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  vi.clearAllMocks();
  if (!globalThis.localStorage) {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, String(value)),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
    });
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ApplicationDetail", () => {
  it("opens a validated tab from navigation query state", async () => {
    window.history.replaceState(null, "", "/?tab=materials");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => [] }) as Response),
    );
    renderDetail(fixtureApplication());

    expect(screen.getByRole("tab", { selected: true }).id)
      .toBe("application-materials-tab");
  });

  it("shows the persisted next action in the current-state banner and editor", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => [] }) as Response),
    );
    const user = userEvent.setup();
    renderDetail(fixtureApplication({
      currentStage: "Awaiting feedback",
      nextAction: "Wait for recruiter feedback; do not follow up yet.",
    }));

    expect(screen.getByText("Wait for recruiter feedback; do not follow up yet.")).toBeTruthy();
    await openEditor(user);
    expect(screen.getByDisplayValue("Wait for recruiter feedback; do not follow up yet.")).toBeTruthy();
  });

  it("renders the application values with a large auto-growing notes field", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => [] }) as Response),
    );
    const user = userEvent.setup();
    renderDetail(fixtureApplication());

    // Read-first: the working brief is prose until the editor is opened. It
    // shows both in the Brief panel and in the Activity tab's context rail.
    expect(screen.getAllByText("Erste Notiz").length).toBeGreaterThan(0);
    await openEditor(user);

    expect(screen.getByText("stack")).toBeTruthy();
    expect(screen.getByText("stack_not_recorded")).toBeTruthy();

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
    await openEditor(user);

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
              jobSummary: "Updated summary",
              updatedAt: `2026-07-0${patchBodies.length + 1}T00:00:00.000Z`,
            }),
          } as Response;
        }
        return { ok: true, json: async () => [] } as Response;
      }),
    );
    const user = userEvent.setup();
    renderDetail(fixtureApplication());
    await openEditor(user);

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
    expect(screen.getAllByText("Updated summary").length).toBeGreaterThan(0);

    // A second save uses the renewed updatedAt — no 409 loop.
    await user.type(notesTextarea(), " v3");
    await user.click(saveButtons()[0]);
    await waitFor(() => expect(patchBodies.length).toBe(2));
    expect(patchBodies[1].expectedUpdatedAt).toBe("2026-07-02T00:00:00.000Z");
    expect(patchBodies[1].notes).toBe("Erste Notiz v2 v3");
  });

  it("discards the draft when the editor is cancelled", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => [] }) as Response),
    );
    const user = userEvent.setup();
    renderDetail(fixtureApplication());
    await openEditor(user);

    await user.type(notesTextarea(), " verworfen");
    expect(screen.getAllByText("unsaved").length).toBeGreaterThan(0);

    // The editor row is desktop-only, so the mobile action bar has to carry
    // the discard too — otherwise a phone cannot get out of edit mode.
    expect(cancelButtons().length).toBe(2);
    await user.click(cancelButtons()[0]);

    // Cancel means cancel: the draft is gone, so the leave guard stands down
    // instead of trapping the user behind a hidden editor.
    expect(screen.queryByText("unsaved")).toBeNull();
    await openEditor(user);
    expect(notesTextarea().value).toBe("Erste Notiz");
  });

  it("keeps the editor open when a contact row is still unsaved", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => [] }) as Response),
    );
    const user = userEvent.setup();
    renderDetail(
      fixtureApplication({
        contacts: [
          {
            id: "contact-1",
            name: "Max",
            email: null,
            phone: null,
            role: null,
            linkedIn: null,
            applicationId: "application-1",
            createdAt: "2026-07-01T00:00:00.000Z",
          },
        ],
      }),
    );
    await openEditor(user);

    // Contact rows save individually, so the form discard does not cover them.
    await user.type(screen.getByPlaceholderText("contact_name_placeholder"), "x");
    await user.click(cancelButtons()[0]);

    expect(screen.getByPlaceholderText("contact_name_placeholder")).toBeTruthy();
  });

  it("discards the draft from the mobile action bar too", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => [] }) as Response),
    );
    const user = userEvent.setup();
    renderDetail(fixtureApplication());
    await openEditor(user);

    await user.type(notesTextarea(), " vom Handy verworfen");
    expect(screen.getAllByText("unsaved").length).toBeGreaterThan(0);

    // The last one is the fixed bottom bar, which is the only control a phone
    // can reach.
    await user.click(cancelButtons()[cancelButtons().length - 1]);

    expect(screen.queryByText("unsaved")).toBeNull();
    await openEditor(user);
    expect(notesTextarea().value).toBe("Erste Notiz");
  });

  it("refuses to close the editor over unsaved work", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => [] }) as Response),
    );
    const user = userEvent.setup();
    renderDetail(fixtureApplication());
    await openEditor(user);

    const done = screen.getAllByRole("button", { name: "done_editing" })[0] as HTMLButtonElement;
    expect(done.disabled).toBe(false);

    await user.type(notesTextarea(), " noch offen");

    // Closing here would hide the only Save and Cancel while the leave guard
    // stays armed, so the hero's Done has to stand down until it is resolved.
    expect(
      (screen.getAllByRole("button", { name: "done_editing" })[0] as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(notesTextarea()).toBeTruthy();

    await user.click(cancelButtons()[0]);
    expect(screen.queryByText("unsaved")).toBeNull();
  });

  it("refuses to discard while a save is in flight", async () => {
    let releaseSave: (() => void) | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "PATCH") {
          const body = JSON.parse(String(init.body)) as Record<string, unknown>;
          // Hold the response open so Cancel can race the success handler.
          await new Promise<void>((resolve) => {
            releaseSave = resolve;
          });
          return {
            ok: true,
            status: 200,
            json: async () => ({
              ...fixtureApplication(),
              notes: body.notes,
              updatedAt: "2026-07-02T00:00:00.000Z",
            }),
          } as Response;
        }
        return { ok: true, json: async () => [] } as Response;
      }),
    );
    const user = userEvent.setup();
    renderDetail(fixtureApplication());
    await openEditor(user);

    await user.type(notesTextarea(), " im Flug");
    await user.click(saveButtons()[0]);
    await waitFor(() => expect(releaseSave).not.toBeNull());

    // Discarding here would restore the old baseline while the success
    // handler adopts the submitted draft, leaving the page permanently dirty.
    for (const button of cancelButtons()) {
      expect(button.disabled).toBe(true);
    }

    releaseSave!();

    await waitFor(() => {
      for (const button of saveButtons()) {
        expect(button.disabled).toBe(true);
      }
    });
    expect(screen.queryByText("unsaved")).toBeNull();
    expect(notesTextarea().value).toBe("Erste Notiz im Flug");
  });

  it("blocks a save on an invalid field and reveals it instead of posting", async () => {
    // The reveal defers reporting to the next frame so the Brief panel is no
    // longer hidden; happy-dom never runs that frame on its own.
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    const patchCalls: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "PATCH") patchCalls.push(init.body);
        return { ok: true, json: async () => [] } as Response;
      }),
    );
    const user = userEvent.setup();
    renderDetail(fixtureApplication());
    await openEditor(user);

    const company = screen.getByDisplayValue("Acme") as HTMLInputElement;
    const reportValidity = vi.fn(() => false);
    company.reportValidity = reportValidity;
    await user.clear(company);
    await user.type(notesTextarea(), " damit dirty");

    // Native validation is off on the form, so the submit path has to run the
    // constraints itself rather than letting an invalid value reach the API.
    await user.click(saveButtons()[0]);

    await waitFor(() => expect(reportValidity).toHaveBeenCalled());
    expect(patchCalls).toHaveLength(0);
    expect(
      (screen.getByRole("tab", { selected: true }) as HTMLElement).id,
    ).toBe("application-brief-tab");
  });

  it("shows travel and timezone facts that have no editor field", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => [] }) as Response),
    );
    renderDetail(
      fixtureApplication({ travelPercent: 20, timezoneOverlap: "CET ± 2h" }),
    );

    expect(screen.getByText("20%")).toBeTruthy();
    expect(screen.getByText("CET ± 2h")).toBeTruthy();
  });

  it("copies the absolute canonical URL", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => [] }) as Response),
    );
    const user = userEvent.setup();
    const writeText = vi.fn(async () => undefined);
    const originalClipboard = Object.getOwnPropertyDescriptor(window.navigator, "clipboard");
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    renderDetail(fixtureApplication());

    await user.click(screen.getByRole("button", { name: "copy_link" }));

    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/applications/application-1/acme-engineer`);
    if (originalClipboard) {
      Object.defineProperty(window.navigator, "clipboard", originalClipboard);
    } else {
      Reflect.deleteProperty(window.navigator, "clipboard");
    }
  });

  it("replaces the URL with the new canonical slug after a company or role rename", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "PATCH") {
          const body = JSON.parse(String(init.body)) as Record<string, unknown>;
          return {
            ok: true,
            status: 200,
            json: async () => ({
              ...fixtureApplication(),
              ...body,
              company: "Newco",
              updatedAt: "2026-07-02T00:00:00.000Z",
            }),
          } as Response;
        }
        return { ok: true, json: async () => [] } as Response;
      }),
    );
    const user = userEvent.setup();
    renderDetail(fixtureApplication());
    await openEditor(user);

    const company = screen.getByDisplayValue("Acme");
    await user.clear(company);
    await user.type(company, "Newco");
    await user.click(saveButtons()[0]);

    await waitFor(() => {
      expect(navigationMocks.replace).toHaveBeenCalledWith("/applications/application-1/newco-engineer");
    });
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
    await openEditor(user);

    await user.type(notesTextarea(), " wichtig");
    await user.click(saveButtons()[0]);

    await screen.findByText("error_conflict");
    expect(notesTextarea().value).toBe("Erste Notiz wichtig");
    // The form stays dirty so the user can retry or reload deliberately.
    expect(saveButtons()[0].disabled).toBe(false);
  });

  it("guards internal navigation while the form has unsaved edits", async () => {
    const confirmSpy = vi.fn(() => false);
    vi.stubGlobal("confirm", confirmSpy);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => [] }) as Response),
    );
    const user = userEvent.setup();
    renderDetail(fixtureApplication());
    await openEditor(user);

    const navLink = screen.getAllByRole("link", { name: "documents" })[0];

    // Clean form: no prompt, nothing prevented.
    const cleanClick = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
    });
    navLink.dispatchEvent(cleanClick);
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(cleanClick.defaultPrevented).toBe(false);

    await user.type(notesTextarea(), " ungespeichert");

    const blockedClick = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
    });
    navLink.dispatchEvent(blockedClick);
    expect(confirmSpy).toHaveBeenCalledWith("leave_confirm");
    expect(blockedClick.defaultPrevented).toBe(true);
  });

  it("treats unsaved contact-row edits as unsaved changes", async () => {
    const confirmSpy = vi.fn(() => false);
    vi.stubGlobal("confirm", confirmSpy);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => [] }) as Response),
    );
    const user = userEvent.setup();
    renderDetail(
      fixtureApplication({
        contacts: [
          {
            id: "contact-1",
            name: "Max",
            email: null,
            phone: null,
            role: null,
            linkedIn: null,
            applicationId: "application-1",
            createdAt: "2026-07-01T00:00:00.000Z",
          },
        ],
      }),
    );

    await openEditor(user);

    // The application form itself is untouched: no hint, main save disabled.
    expect(saveButtons()[0].disabled).toBe(true);
    expect(screen.queryByText("unsaved")).toBeNull();

    await user.type(screen.getByPlaceholderText("contact_name_placeholder"), "x");

    expect(screen.getAllByText("unsaved").length).toBeGreaterThan(0);
    // Contact rows persist via their own save button, so the main save
    // stays disabled — but navigation is guarded.
    expect(saveButtons()[0].disabled).toBe(true);

    const navLink = screen.getAllByRole("link", { name: "documents" })[0];
    const blockedClick = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
    });
    navLink.dispatchEvent(blockedClick);
    expect(confirmSpy).toHaveBeenCalledWith("leave_confirm");
    expect(blockedClick.defaultPrevented).toBe(true);
  });

  it("renews the save baseline after tailoring a resume", async () => {
    const patchBodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/tailor")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              resumeId: "resume-new",
              editUrl: "https://resume.example/edit/resume-new",
              updatedAt: "2026-07-03T00:00:00.000Z",
            }),
          } as Response;
        }
        if (init?.method === "PATCH") {
          const body = JSON.parse(String(init.body)) as Record<string, unknown>;
          patchBodies.push(body);
          return {
            ok: true,
            status: 200,
            json: async () => ({
              ...fixtureApplication(),
              notes: body.notes,
              updatedAt: "2026-07-04T00:00:00.000Z",
            }),
          } as Response;
        }
        return { ok: true, json: async () => [] } as Response;
      }),
    );
    const user = userEvent.setup();
    renderDetail(fixtureApplication({ resumeId: null }));

    await openTab(user, "tab_materials");
    await user.click(screen.getByRole("button", { name: "resume_tailor" }));
    await screen.findByRole("button", { name: "resume_open" });

    await openEditor(user);
    await user.type(notesTextarea(), " nach Tailoring");
    await user.click(saveButtons()[0]);

    // Without the refreshed baseline this would be the stale fixture
    // timestamp and the server would answer 409.
    await waitFor(() => expect(patchBodies.length).toBe(1));
    expect(patchBodies[0].expectedUpdatedAt).toBe("2026-07-03T00:00:00.000Z");
  });

  it("adopts the tailored resume across the page without a reload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).endsWith("/tailor")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              resumeId: "resume-new",
              editUrl: "https://resume.example/edit/resume-new",
              updatedAt: "2026-07-03T00:00:00.000Z",
            }),
          } as Response;
        }
        return { ok: true, json: async () => [] } as Response;
      }),
    );
    const user = userEvent.setup();
    renderDetail(fixtureApplication({ resumeId: null }));

    // The Activity rail reports the link state, so it must not stay stale.
    expect(screen.getByText("no_resume")).toBeTruthy();

    await openTab(user, "tab_materials");
    await user.click(screen.getByRole("button", { name: "resume_tailor" }));
    await screen.findByRole("button", { name: "resume_open" });

    await openTab(user, "tab_activity");
    expect(screen.getByText("resume_linked")).toBeTruthy();
    expect(screen.queryByText("no_resume")).toBeNull();
  });

  it("keeps submission history with documents and resume actions in Materials", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).endsWith("/submissions")) {
          return {
            ok: true,
            json: async () => [{
              id: "submission-1",
              submittedAt: "2026-07-05T10:30:00.000Z",
              atsName: "Greenhouse",
              requisitionId: "REQ-42",
              documentIds: ["document-1", "document-2"],
            }],
          } as Response;
        }
        return { ok: true, json: async () => [] } as Response;
      }),
    );
    const user = userEvent.setup();
    renderDetail(fixtureApplication({ resumeId: "resume-1" }));

    await openTab(user, "tab_materials");

    expect(await screen.findByText("submission_history")).toBeTruthy();
    expect(screen.getByText("Greenhouse")).toBeTruthy();
    expect(screen.getByText("REQ-42")).toBeTruthy();
    expect(screen.getByText("2 submission_documents")).toBeTruthy();
    expect(screen.getByText("documents_reactive_resume")).toBeTruthy();
  });

  it("publishes active-record and dirty-editor context and accepts scoped tab commands", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => [] }) as Response),
    );
    const updates: Record<string, unknown>[] = [];
    const onContext = (event: Event) => {
      updates.push((event as CustomEvent<Record<string, unknown>>).detail);
    };
    window.addEventListener("nexus:assistant-context", onContext);
    const user = userEvent.setup();
    renderDetail(fixtureApplication());

    await waitFor(() => expect(updates.at(-1)).toMatchObject({
      activeRecordId: "application-1",
      dirtyEditorIds: [],
    }));

    await openEditor(user);
    await user.type(notesTextarea(), " pending");
    await waitFor(() => expect(updates.at(-1)).toMatchObject({
      activeRecordId: "application-1",
      dirtyEditorIds: ["application-1"],
    }));

    act(() => {
      window.dispatchEvent(new CustomEvent("nexus:assistant-capability", {
        detail: {
          name: "open_tab",
          arguments: { applicationId: "application-1", tab: "materials" },
        },
      }));
    });
    await waitFor(() => expect(screen.getByRole("tab", { selected: true }).id)
      .toBe("application-materials-tab"));
    expect(notesTextarea().value).toBe("Erste Notiz pending");

    act(() => {
      window.dispatchEvent(new CustomEvent("nexus:assistant-capability", {
        detail: {
          name: "highlight_field",
          arguments: { applicationId: "application-1", field: "company" },
        },
      }));
    });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByDisplayValue("Acme")));
    expect(screen.getByRole("tab", { selected: true }).id).toBe("application-brief-tab");
    expect(notesTextarea().value).toBe("Erste Notiz pending");
    window.removeEventListener("nexus:assistant-context", onContext);
  });

  it("vetoes browser history navigation while edits are unsaved", async () => {
    const confirmSpy = vi.fn(() => false);
    vi.stubGlobal("confirm", confirmSpy);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => [] }) as Response),
    );
    const pushStateSpy = vi.spyOn(window.history, "pushState");
    const user = userEvent.setup();
    renderDetail(fixtureApplication());

    await openEditor(user);

    window.dispatchEvent(new Event("popstate"));
    expect(confirmSpy).not.toHaveBeenCalled();

    await user.type(notesTextarea(), " ungespeichert");
    window.dispatchEvent(new Event("popstate"));
    expect(confirmSpy).toHaveBeenCalledWith("leave_confirm");
    expect(pushStateSpy).toHaveBeenCalledWith(
      null,
      "",
      "/applications/application-1/acme-engineer",
    );
  });

  it("confirms before logging out with unsaved edits", async () => {
    const confirmSpy = vi.fn(() => false);
    vi.stubGlobal("confirm", confirmSpy);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => [] }) as Response),
    );
    const user = userEvent.setup();
    renderDetail(fixtureApplication());
    await openEditor(user);

    await user.type(notesTextarea(), " ungespeichert");
    await user.click(screen.getAllByRole("button", { name: "account_menu" })[0]);
    await user.click(await screen.findByRole("menuitem", { name: "logout" }));

    expect(confirmSpy).toHaveBeenCalledWith("leave_confirm");
    expect(authClient.signOut).not.toHaveBeenCalled();
  });
});
