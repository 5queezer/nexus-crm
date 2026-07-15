// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as headerUtilityMenu from "../header-utility-menu";

const { HeaderUtilityMenu, HeaderUtilityMenuPanel } = headerUtilityMenu;
const menuHelpers = headerUtilityMenu as typeof headerUtilityMenu & {
  getNextMenuItemIndex?: (currentIndex: number, itemCount: number, key: "ArrowDown" | "ArrowUp") => number;
  getHeaderUtilityMenuDisclosureKey?: (pathname: string) => string;
  shouldDismissMenuForPointer?: (insideRoot: boolean, insideMenu: boolean) => boolean;
  getMenuKeyboardDismissal?: (key: string) => { close: boolean; restoreFocus: boolean };
};
const navigation = vi.hoisted(() => ({ pathname: "/" }));

vi.mock("next-intl", () => ({
  useLocale: () => "de",
  useTranslations: () => (key: string) => ({
    share: "Teilen",
    logout: "Abmelden",
    signed_in_as: "Angemeldet als",
    theme: "Darstellung",
    theme_light: "Hell",
    theme_dark: "Dunkel",
    theme_system: "System",
    language: "Sprache",
  })[key] ?? key,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  usePathname: () => navigation.pathname,
}));

describe("HeaderUtilityMenuPanel", () => {
  it("groups account context and low-frequency global actions", () => {
    const html = renderToStaticMarkup(
      <HeaderUtilityMenuPanel
        user={{ name: "Chris", email: "chris@example.com" }}
        shareUrl="https://example.com/share"
        onLogout={vi.fn()}
      />,
    );

    expect(html).toContain("Chris");
    expect(html).toContain("chris@example.com");
    expect(html).toContain("Teilen");
    expect(html).toContain("Abmelden");
    expect(html).toContain("theme-menu-control");
    expect(html).toContain("language-menu-control");
    expect(html.match(/min-h-12/g)).toHaveLength(4);
    expect(html.match(/role="none"/g)).toHaveLength(4);
  });

  it("omits sharing when no share URL is available", () => {
    const html = renderToStaticMarkup(
      <HeaderUtilityMenuPanel
        user={{ email: "chris@example.com" }}
        onLogout={vi.fn()}
      />,
    );

    expect(html).not.toContain("Teilen");
    expect(html).toContain("chris@example.com");
  });

  it("keeps disclosure content out of the initial render", () => {
    const html = renderToStaticMarkup(
      <HeaderUtilityMenu user={{ email: "chris@example.com" }} onLogout={vi.fn()} />,
    );

    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("nexus-target");
    expect(html).not.toContain('role="menu"');
  });
});

describe("header utility menu interaction rules", () => {
  it("starts ArrowUp at the last item when focus is outside the menu", () => {
    expect(menuHelpers.getNextMenuItemIndex?.(-1, 4, "ArrowUp")).toBe(3);
  });

  it("starts ArrowDown at the first item when focus is outside the menu", () => {
    expect(menuHelpers.getNextMenuItemIndex?.(-1, 4, "ArrowDown")).toBe(0);
  });

  it("wraps keyboard navigation when an item is focused", () => {
    expect(menuHelpers.getNextMenuItemIndex?.(3, 4, "ArrowDown")).toBe(0);
    expect(menuHelpers.getNextMenuItemIndex?.(0, 4, "ArrowUp")).toBe(3);
  });

  it("dismisses an open menu when the pathname changes", () => {
    expect(menuHelpers.getHeaderUtilityMenuDisclosureKey?.("/")).not.toBe(
      menuHelpers.getHeaderUtilityMenuDisclosureKey?.("/documents"),
    );
  });

  it("dismisses only pointer events outside both trigger and portal", () => {
    expect(menuHelpers.shouldDismissMenuForPointer?.(false, false)).toBe(true);
    expect(menuHelpers.shouldDismissMenuForPointer?.(true, false)).toBe(false);
    expect(menuHelpers.shouldDismissMenuForPointer?.(false, true)).toBe(false);
  });

  it("restores trigger focus only for Escape dismissal", () => {
    expect(menuHelpers.getMenuKeyboardDismissal?.("Escape")).toEqual({ close: true, restoreFocus: true });
    expect(menuHelpers.getMenuKeyboardDismissal?.("Tab")).toEqual({ close: true, restoreFocus: false });
    expect(menuHelpers.getMenuKeyboardDismissal?.("Enter")).toEqual({ close: false, restoreFocus: false });
  });
});

describe("HeaderUtilityMenu interactions", () => {
  let container: HTMLDivElement;
  let root: Root;

  async function renderMenu() {
    await act(async () => {
      root.render(<HeaderUtilityMenu user={{ name: "Chris", email: "chris@example.com" }} onLogout={vi.fn()} />);
    });
  }

  async function openMenu(): Promise<HTMLButtonElement> {
    const trigger = container.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]');
    if (!trigger) throw new Error("Menu trigger was not rendered");
    await act(async () => {
      trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    return trigger;
  }

  beforeEach(() => {
    navigation.pathname = "/";
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
  });

  it("mounts the menu in a body portal when the trigger opens it", async () => {
    await renderMenu();
    await openMenu();

    const menu = document.body.querySelector('[role="menu"]');
    expect(menu).not.toBeNull();
    expect(container.querySelector('[role="menu"]')).toBeNull();
  });

  it("dismisses the portal on an outside pointer event", async () => {
    await renderMenu();
    await openMenu();

    await act(async () => {
      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });

    expect(document.body.querySelector('[role="menu"]')).toBeNull();
  });

  it("dismisses on Escape and restores focus to the trigger", async () => {
    await renderMenu();
    const trigger = await openMenu();

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });

    expect(document.body.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("dismisses the open portal after a pathname change", async () => {
    await renderMenu();
    await openMenu();
    expect(document.body.querySelector('[role="menu"]')).not.toBeNull();

    navigation.pathname = "/documents";
    await renderMenu();

    expect(document.body.querySelector('[role="menu"]')).toBeNull();
  });

  it("moves ArrowUp from outside the menu to the last menu item", async () => {
    await renderMenu();
    const trigger = await openMenu();
    const menu = document.body.querySelector<HTMLElement>('[role="menu"]');
    const items = Array.from(document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    if (!menu || items.length === 0) throw new Error("Menu items were not rendered");
    trigger.focus();

    await act(async () => {
      menu.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    });

    expect(document.activeElement).toBe(items.at(-1));
  });
});
