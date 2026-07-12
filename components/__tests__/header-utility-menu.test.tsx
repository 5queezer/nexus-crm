import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { HeaderUtilityMenuPanel } from "../header-utility-menu";

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
});
