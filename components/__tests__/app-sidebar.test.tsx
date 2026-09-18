import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AppSidebar, initialsFor } from "../app-sidebar";
import { isRouteActive } from "../navigation-routes";

const translations: Record<string, string> = {
  "app.title": "Nexus CRM",
  "nav.primary": "Primary navigation",
  "nav.group_workspace": "Workspace",
  "nav.group_tools": "Tools",
  "nav.opportunities": "Opportunities",
  "nav.activity": "Activity",
  "nav.documents": "Documents",
  "nav.analytics": "Analytics",
  "nav.resume_ai": "Resume AI",
  "nav.settings": "Settings",
  "nav.personal_workspace": "Personal workspace",
};

const navigation = vi.hoisted(() => ({ pathname: "/" }));

vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) => (key: string) =>
    translations[`${namespace}.${key}`] ?? key,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
}));

describe("AppSidebar", () => {
  it("groups the workspace destinations and hides admin-only settings", () => {
    const html = renderToStaticMarkup(
      <AppSidebar user={{ name: "Chris", email: "chris@example.com", isAdmin: false }} />,
    );

    expect(html).toContain("Workspace");
    expect(html).toContain("Opportunities");
    expect(html).toContain("Resume AI");
    expect(html).not.toContain("Settings");
    expect(html).toContain(">C<");
  });

  it("shows settings for admins", () => {
    const html = renderToStaticMarkup(
      <AppSidebar user={{ email: "chris@example.com", isAdmin: true }} />,
    );

    expect(html).toContain("Settings");
  });
});

describe("initialsFor", () => {
  it("takes two initials from a full name", () => {
    expect(initialsFor("Christian Pojoni", "c@example.com")).toBe("CP");
  });

  it("falls back to the email when no name is set", () => {
    expect(initialsFor(null, "chris@example.com")).toBe("C");
  });
});

describe("isRouteActive", () => {
  it("keeps Opportunities active on an application detail route", () => {
    expect(isRouteActive("/", "/applications/abc/acme-engineer")).toBe(true);
    expect(isRouteActive("/", "/documents")).toBe(false);
  });

  it("matches a section and its children but not a sibling prefix", () => {
    expect(isRouteActive("/activity", "/activity")).toBe(true);
    expect(isRouteActive("/activity", "/activity/2026")).toBe(true);
    expect(isRouteActive("/activity", "/activity-log")).toBe(false);
  });

  it("treats a missing pathname as nothing active", () => {
    expect(isRouteActive("/", undefined)).toBe(false);
  });
});
