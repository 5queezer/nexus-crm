import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import * as headerUtilityMenu from "../header-utility-menu";

const { HeaderUtilityMenu, HeaderUtilityMenuPanel } = headerUtilityMenu;
const menuHelpers = headerUtilityMenu as typeof headerUtilityMenu & {
  getNextMenuItemIndex?: (currentIndex: number, itemCount: number, key: "ArrowDown" | "ArrowUp") => number;
  getHeaderUtilityMenuDisclosureKey?: (pathname: string) => string;
  shouldDismissMenuForPointer?: (insideRoot: boolean, insideMenu: boolean) => boolean;
  getMenuKeyboardDismissal?: (key: string) => { close: boolean; restoreFocus: boolean };
};

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
  usePathname: () => "/",
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
