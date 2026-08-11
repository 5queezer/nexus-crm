// @vitest-environment happy-dom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  callbackURL: "/",
  social: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams({ callbackURL: mocks.callbackURL }),
}));
vi.mock("next-intl", () => ({
  useTranslations: () => Object.assign((key: string) => key, {
    rich: (key: string) => key,
  }),
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: { signIn: { social: mocks.social } },
}));
vi.mock("@/components/language-switcher", () => ({ LanguageSwitcher: () => null }));
vi.mock("@/components/theme-switcher", () => ({ ThemeSwitcher: () => null }));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

import LoginPage from "../page";

describe("login callback forwarding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.social.mockResolvedValue(undefined);
  });

  it("forwards an internal application path through the Google login flow", async () => {
    mocks.callbackURL = "/applications/106/hygraph-senior-fullstack-engineer";
    render(<LoginPage />);

    await userEvent.click(screen.getByRole("button", { name: /login\.button/ }));

    expect(mocks.social).toHaveBeenCalledWith({
      provider: "google",
      callbackURL: "/applications/106/hygraph-senior-fullstack-engineer",
    });
  });

  it("preserves a same-origin absolute MCP authorization callback", async () => {
    mocks.callbackURL = new URL("/api/mcp/authorize", window.location.origin).toString();
    render(<LoginPage />);

    await userEvent.click(screen.getByRole("button", { name: /login\.button/ }));

    expect(mocks.social).toHaveBeenCalledWith({
      provider: "google",
      callbackURL: mocks.callbackURL,
    });
  });

  it("replaces an external callback with the safe dashboard fallback", async () => {
    mocks.callbackURL = "https://evil.example/steal";
    render(<LoginPage />);

    await userEvent.click(screen.getByRole("button", { name: /login\.button/ }));

    expect(mocks.social).toHaveBeenCalledWith({
      provider: "google",
      callbackURL: "/",
    });
  });
});
