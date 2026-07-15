/** @vitest-environment jsdom */

import { useCallback, useRef, useState } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "@/messages/en.json";
import { MobileNavigationSheet } from "../mobile-navigation-sheet";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

function SheetHarness() {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => {
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      <button ref={triggerRef} type="button" onClick={() => setOpen(true)}>
        Open menu
      </button>
      <MobileNavigationSheet open={open} isAdmin onClose={close} />
    </NextIntlClientProvider>
  );
}

describe("MobileNavigationSheet interactions", () => {
  let breakpointListener: ((event: MediaQueryListEvent) => void) | undefined;

  beforeEach(() => {
    vi.stubGlobal(
      "requestAnimationFrame",
      (callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      },
    );
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: false,
        addEventListener: (
          _event: string,
          listener: (event: MediaQueryListEvent) => void,
        ) => {
          breakpointListener = listener;
        },
        removeEventListener: vi.fn(),
      })),
    );
    breakpointListener = undefined;
    document.body.style.overflow = "";
  });

  it("is a named modal, locks body scroll, and traps focus", async () => {
    const user = userEvent.setup();
    render(<SheetHarness />);

    await user.click(screen.getByRole("button", { name: "Open menu" }));
    const dialog = screen.getByRole("dialog", { name: "Navigation" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(document.body.style.overflow).toBe("hidden");

    const focusable = within(dialog).getAllByRole("button").concat(
      within(dialog).getAllByRole("link"),
    );
    expect(dialog.contains(document.activeElement)).toBe(true);

    const first = dialog.querySelector<HTMLElement>("a, button:not(:disabled)");
    const all = dialog.querySelectorAll<HTMLElement>(
      "a, button:not(:disabled)",
    );
    const last = all.item(all.length - 1);
    first?.focus();
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(last);
    await user.tab();
    expect(document.activeElement).toBe(first);
    expect(focusable.length).toBeGreaterThan(1);
  });

  it("closes on Escape, restores body scroll, and restores trigger focus", async () => {
    const user = userEvent.setup();
    render(<SheetHarness />);
    const trigger = screen.getByRole("button", { name: "Open menu" });

    await user.click(trigger);
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: "Navigation" })).toBeNull();
    expect(document.body.style.overflow).toBe("");
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("closes and releases scroll lock when crossing the lg breakpoint", async () => {
    const user = userEvent.setup();
    render(<SheetHarness />);
    const trigger = screen.getByRole("button", { name: "Open menu" });

    await user.click(trigger);
    expect(document.body.style.overflow).toBe("hidden");
    breakpointListener?.({ matches: true } as MediaQueryListEvent);

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Navigation" })).toBeNull();
      expect(document.body.style.overflow).toBe("");
      expect(document.activeElement).toBe(trigger);
    });
  });

  it("closes from the backdrop and restores focus", async () => {
    const user = userEvent.setup();
    render(<SheetHarness />);
    const trigger = screen.getByRole("button", { name: "Open menu" });

    await user.click(trigger);
    const closeButtons = screen.getAllByRole("button", {
      name: "Close navigation",
    });
    expect(closeButtons).toHaveLength(2);
    await user.click(closeButtons[0]);

    expect(screen.queryByRole("dialog", { name: "Navigation" })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});
