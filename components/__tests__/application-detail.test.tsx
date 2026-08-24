// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
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

// Career Ops is exercised on its own; here only the opportunity it is handed
// matters — the agent resolves that record by id and the drawer labels it.
vi.mock("@/components/career-ops/career-ops", () => ({
  CareerOps: (props: { application?: { id: string; company: string; role: string } }) => (
    <div
      data-testid="career-ops"
      data-company={props.application?.company ?? ""}
      data-role={props.application?.role ?? ""}
    />
  ),
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

function detailElement(application: Application) {
  return (
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
    </QueryClientProvider>
  );
}

function renderDetail(application: Application) {
  const view = render(detailElement(application));
  return {
    ...view,
    /** What `router.refresh()` does: the same page, a newer server record. */
    refreshWith: (next: Application) => view.rerender(detailElement(next)),
  };
}

function notesTextarea(): HTMLTextAreaElement {
  return screen.getByPlaceholderText(
    "notes_placeholder",
  ) as HTMLTextAreaElement;
}

function saveButtons(): HTMLButtonElement[] {
  return screen.getAllByRole("button", { name: "save" }) as HTMLButtonElement[];
}

beforeEach(() => {
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

  it("shows contacts an agent added, and keeps an unsaved row edit", async () => {
    // Contact rows were read from a `useState` initializer and never again, so
    // a Career Ops run that added or changed a contact left the page on the
    // pre-run list: the new contact was invisible, and saving a stale row
    // overwrote what the agent had just written. Adoption must not cost the
    // user an edit they have in hand either.
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => [] }) as Response),
    );
    const view = renderDetail(
      fixtureApplication({
        contacts: [
          { id: "c1", name: "Ada", email: "", role: "", linkedIn: "" },
        ] as Application["contacts"],
      }),
    );

    // Edit the existing row without saving it.
    const nameInputs = screen.getAllByDisplayValue("Ada");
    await user.clear(nameInputs[0]);
    await user.type(nameInputs[0], "Ada Lovelace");

    view.refreshWith(
      fixtureApplication({
        // Deliberately unchanged. No backend touches the application row when a
        // contact is created, updated or deleted, so keying adoption to this
        // timestamp — as the first attempt did — never fires for exactly the
        // case it was written for.
        updatedAt: "2026-07-01T00:00:00.000Z",
        contacts: [
          // The agent renamed the row the user is editing, and added another.
          { id: "c1", name: "Ada B.", email: "", role: "", linkedIn: "" },
          { id: "c2", name: "Grace", email: "", role: "", linkedIn: "" },
        ] as Application["contacts"],
      }),
    );

    // The agent's new contact is visible…
    await waitFor(() => expect(screen.getAllByDisplayValue("Grace").length).toBe(1));
    // …and the unsaved edit survived rather than being overwritten.
    expect(screen.getAllByDisplayValue("Ada Lovelace").length).toBe(1);
    expect(screen.queryByDisplayValue("Ada B.")).toBeNull();
  });

  it("does not re-add a contact from a snapshot taken before its deletion", async () => {
    // A refresh landing mid-write is deferred, not dropped — and then applied
    // from a snapshot that cannot contain the write it was taken before. The
    // deleted row came straight back, and this page does not consume the
    // invalidated query, so it stayed on screen until some later refresh.
    const user = userEvent.setup();
    let finishDelete: () => void = () => {};
    const deleted = new Promise<void>((resolve) => {
      finishDelete = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "DELETE") {
          await deleted;
          return { ok: true, status: 204, json: async () => ({}) } as Response;
        }
        return { ok: true, json: async () => [] } as Response;
      }),
    );
    const view = renderDetail(
      fixtureApplication({
        contacts: [
          { id: "c1", name: "Ada", email: "", role: "", linkedIn: "" },
        ] as Application["contacts"],
      }),
    );

    await user.click(screen.getAllByRole("button", { name: "contact_remove" })[0]);

    // A Career Ops refresh lands while the delete is still in flight: a genuine
    // change — the agent added a contact — but taken before the deletion, so it
    // still carries the row being removed.
    view.refreshWith(
      fixtureApplication({
        updatedAt: "2026-07-02T00:00:00.000Z",
        contacts: [
          { id: "c1", name: "Ada", email: "", role: "", linkedIn: "" },
          { id: "c2", name: "Grace", email: "", role: "", linkedIn: "" },
        ] as Application["contacts"],
      }),
    );

    finishDelete();

    await waitFor(() => expect(screen.queryByDisplayValue("Ada")).toBeNull());
    // And the page asks for a snapshot that includes the deletion, rather than
    // living without whatever that refresh legitimately carried.
    expect(navigationMocks.refresh).toHaveBeenCalled();

    // A later snapshot that reflects the deletion is adopted normally.
    view.refreshWith(
      fixtureApplication({
        updatedAt: "2026-07-03T00:00:00.000Z",
        contacts: [
          { id: "c2", name: "Grace", email: "", role: "", linkedIn: "" },
        ] as Application["contacts"],
      }),
    );
    await waitFor(() => expect(screen.getAllByDisplayValue("Grace").length).toBe(1));
    expect(screen.queryByDisplayValue("Ada")).toBeNull();
  });

  it("adopts a newer server record delivered by a refresh", async () => {
    // `useState` reads its initializer once, so the baseline was frozen at
    // mount. A Career Ops run that changes the record calls `router.refresh()`,
    // which re-renders this page with a newer one — and the form went on
    // holding the mount-time concurrency token, so the next save answered 409
    // for a change the user had already been shown.
    const patchBodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "PATCH") {
          patchBodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
          return { ok: true, status: 200, json: async () => fixtureApplication() } as Response;
        }
        return { ok: true, json: async () => [] } as Response;
      }),
    );
    const user = userEvent.setup();
    const view = renderDetail(fixtureApplication());

    view.refreshWith(
      fixtureApplication({
        jobSummary: "Rewritten by the agent",
        updatedAt: "2026-07-05T00:00:00.000Z",
      }),
    );

    // The refresh is visible, not merely fetched.
    await waitFor(() => expect(screen.getByText("Rewritten by the agent")).toBeTruthy());

    await user.type(notesTextarea(), " after refresh");
    await user.click(saveButtons()[0]);

    await waitFor(() => expect(patchBodies.length).toBe(1));
    expect(patchBodies[0].expectedUpdatedAt).toBe("2026-07-05T00:00:00.000Z");
  });

  it("hands Career Ops the company that was just saved", async () => {
    // The page keeps the latest persisted record for display, but Career Ops
    // was handed the mount-time prop, which does not change when a save
    // succeeds — only on a server refresh or navigation. So after renaming the
    // company the drawer went on labelling the conversation with the old name
    // while the agent, resolving the same id, acted on the new one: the visible
    // target and the target of the run and its approval prompts disagreed.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "PATCH") {
          return {
            ok: true,
            status: 200,
            json: async () =>
              fixtureApplication({ company: "Renamed", updatedAt: "2026-07-09T00:00:00.000Z" }),
          } as Response;
        }
        return { ok: true, json: async () => [] } as Response;
      }),
    );
    const user = userEvent.setup();
    renderDetail(fixtureApplication());
    expect(screen.getByTestId("career-ops").getAttribute("data-company")).toBe("Acme");

    const company = screen.getByPlaceholderText("company_placeholder") as HTMLInputElement;
    await user.clear(company);
    await user.type(company, "Renamed");
    await user.click(saveButtons()[0]);

    await waitFor(() =>
      expect(screen.getByTestId("career-ops").getAttribute("data-company")).toBe("Renamed"),
    );
  });

  it("keeps a stale token rather than dropping unsaved edits on a refresh", async () => {
    // With edits in hand the stale token is the protection: the 409 is what
    // tells the user their copy is behind. Adopting the new one silently would
    // let them overwrite the change they were never shown, and replacing the
    // form would throw their edit away.
    const patchBodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "PATCH") {
          patchBodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
          return { ok: true, status: 200, json: async () => fixtureApplication() } as Response;
        }
        return { ok: true, json: async () => [] } as Response;
      }),
    );
    const user = userEvent.setup();
    const view = renderDetail(fixtureApplication());

    await user.type(notesTextarea(), " my edit");
    view.refreshWith(
      fixtureApplication({ notes: "agent overwrote this", updatedAt: "2026-07-05T00:00:00.000Z" }),
    );

    expect(notesTextarea().value).toBe("Erste Notiz my edit");
    await user.click(saveButtons()[0]);
    await waitFor(() => expect(patchBodies.length).toBe(1));
    expect(patchBodies[0].expectedUpdatedAt).toBe("2026-07-01T00:00:00.000Z");
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
    expect(screen.getByText("Updated summary")).toBeTruthy();

    // A second save uses the renewed updatedAt — no 409 loop.
    await user.type(notesTextarea(), " v3");
    await user.click(saveButtons()[0]);
    await waitFor(() => expect(patchBodies.length).toBe(2));
    expect(patchBodies[1].expectedUpdatedAt).toBe("2026-07-02T00:00:00.000Z");
    expect(patchBodies[1].notes).toBe("Erste Notiz v2 v3");
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

    await user.click(screen.getByRole("button", { name: "resume_tailor" }));
    await screen.findByRole("button", { name: "resume_open" });

    await user.type(notesTextarea(), " nach Tailoring");
    await user.click(saveButtons()[0]);

    // Without the refreshed baseline this would be the stale fixture
    // timestamp and the server would answer 409.
    await waitFor(() => expect(patchBodies.length).toBe(1));
    expect(patchBodies[0].expectedUpdatedAt).toBe("2026-07-03T00:00:00.000Z");
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

    await user.type(notesTextarea(), " ungespeichert");
    await user.click(screen.getAllByRole("button", { name: "account_menu" })[0]);
    await user.click(await screen.findByRole("menuitem", { name: "logout" }));

    expect(confirmSpy).toHaveBeenCalledWith("leave_confirm");
    expect(authClient.signOut).not.toHaveBeenCalled();
  });
});
