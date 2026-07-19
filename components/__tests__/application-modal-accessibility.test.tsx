// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApplicationModal } from "../application-modal";

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string) => key,
}));

describe("ApplicationModal accessibility", () => {
  let root: Root;
  let container: HTMLDivElement;
  let opener: HTMLButtonElement;

  beforeEach(() => {
    opener = document.createElement("button");
    opener.textContent = "Open editor";
    document.body.appendChild(opener);
    opener.focus();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
    document.body.style.overflow = "";
  });

  it("labels the modal, traps focus, handles Escape, locks scroll, and restores focus", async () => {
    const onClose = vi.fn();
    await act(async () => {
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <ApplicationModal onClose={onClose} />
        </QueryClientProvider>,
      );
    });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

    const dialog = container.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.className).toContain("nexus-scroll");
    expect(dialog?.getAttribute("aria-modal")).toBe("true");
    expect(dialog?.getAttribute("aria-labelledby")).toBe(
      "application-modal-title",
    );
    expect(
      container.querySelector("#application-modal-title")?.textContent,
    ).toBe("title_new");
    expect(
      container.querySelector('button[aria-label="close"]'),
    ).not.toBeNull();
    expect(document.body.style.overflow).toBe("hidden");
    expect(dialog?.contains(document.activeElement)).toBe(true);

    const focusable = Array.from(
      dialog!.querySelectorAll<HTMLElement>(
        "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)",
      ),
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    last.focus();
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
    );
    expect(document.activeElement).toBe(first);

    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(onClose).toHaveBeenCalledOnce();

    await act(async () => root.unmount());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(document.body.style.overflow).toBe("");
    expect(document.activeElement).toBe(opener);
    root = createRoot(container);
  });

  it("keeps compact rating and contact actions at least 48px", async () => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <ApplicationModal onClose={vi.fn()} />
        </QueryClientProvider>,
      );
    });

    const buttonWithText = (text: string) =>
      Array.from(container.querySelectorAll("button")).find((button) =>
        button.textContent?.includes(text),
      );

    await act(async () => buttonWithText("secondary_details")?.click());
    expect(
      container.querySelector<HTMLButtonElement>('button[title="1 / 5"]')
        ?.className,
    ).toContain("nexus-target");

    await act(async () => buttonWithText("contacts_section")?.click());
    const addContact = buttonWithText("contacts_add");
    expect(addContact?.className).toContain("nexus-target");

    await act(async () => addContact?.click());
    expect(buttonWithText("contact_save")?.className).toContain("nexus-target");
    expect(buttonWithText("contact_remove")?.className).toContain(
      "nexus-target",
    );
  });
});
