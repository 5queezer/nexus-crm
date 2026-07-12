import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppHeader } from "../app-header";

const translations: Record<string, string> = {
  "app.title": "Nexus CRM",
  "app.eyebrow": "Opportunity OS",
  "nav.opportunities": "Opportunities",
  "nav.documents": "Documents",
  "nav.analytics": "Analytics",
  "nav.resume_ai": "Resume AI",
  "nav.settings": "Settings",
  "nav.share": "Share",
  "nav.logout": "Sign out",
};

vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) => (key: string) =>
    translations[`${namespace}.${key}`] ?? key,
  useLocale: () => "en",
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: { signOut: vi.fn() },
}));

describe("AppHeader", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders one product brand and names the home destination Opportunities", () => {
    const html = renderToStaticMarkup(
      <AppHeader
        user={{ name: "Chris", email: "chris@example.com", isAdmin: true }}
        shareUrl="https://example.com/share"
      />,
    );

    expect(html.match(/Nexus CRM/g)).toHaveLength(1);
    expect(html).toContain('href="/"');
    expect(html).toContain("Opportunities");
  });
});
