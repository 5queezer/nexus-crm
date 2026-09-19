// @vitest-environment happy-dom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  callbackURL: "/",
  social: vi.fn(),
  email: vi.fn(),
  localDevelopmentEnabled: false,
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
  authClient: { signIn: { social: mocks.social, email: mocks.email } },
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
    mocks.email.mockResolvedValue({ data: {}, error: null });
    mocks.localDevelopmentEnabled = false;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ enabled: mocks.localDevelopmentEnabled }),
    })));
  });

  it("forwards an internal application path through the Google login flow", async () => {
    mocks.callbackURL = "/applications/106/hygraph-senior-fullstack-engineer";
    render(<LoginPage />);

    await userEvent.click(await screen.findByRole("button", { name: /login\.button/ }));

    expect(mocks.social).toHaveBeenCalledWith({
      provider: "google",
      callbackURL: "/applications/106/hygraph-senior-fullstack-engineer",
    });
  });

  it("preserves a same-origin absolute MCP authorization callback", async () => {
    mocks.callbackURL = new URL("/api/mcp/authorize", window.location.origin).toString();
    render(<LoginPage />);

    await userEvent.click(await screen.findByRole("button", { name: /login\.button/ }));

    expect(mocks.social).toHaveBeenCalledWith({
      provider: "google",
      callbackURL: mocks.callbackURL,
    });
  });

  it("replaces an external callback with the safe dashboard fallback", async () => {
    mocks.callbackURL = "https://evil.example/steal";
    render(<LoginPage />);

    await userEvent.click(await screen.findByRole("button", { name: /login\.button/ }));

    expect(mocks.social).toHaveBeenCalledWith({
      provider: "google",
      callbackURL: "/",
    });
  });

  it("uses Better Auth email sign-in with a safe callback in local development", async () => {
    mocks.localDevelopmentEnabled = true;
    mocks.callbackURL = "https://evil.example/steal";
    render(<LoginPage />);

    await screen.findByRole("textbox", { name: /login\.email_label/ });
    await userEvent.type(screen.getByRole("textbox", { name: /login\.email_label/ }), "dev@example.test");
    await userEvent.type(screen.getByLabelText(/login\.password_label/), "local-password");
    await userEvent.click(screen.getByRole("button", { name: /login\.email_button/ }));

    expect(mocks.email).toHaveBeenCalledWith({
      email: "dev@example.test",
      password: "local-password",
      callbackURL: `${window.location.origin}/`,
    });
  });

  it("shows a generic error when local credential sign-in is rejected", async () => {
    mocks.localDevelopmentEnabled = true;
    mocks.email.mockResolvedValue({ data: null, error: { message: "Invalid password" } });
    render(<LoginPage />);

    await userEvent.type(await screen.findByRole("textbox", { name: /login\.email_label/ }), "dev@example.test");
    await userEvent.type(screen.getByLabelText(/login\.password_label/), "wrong-password");
    await userEvent.click(screen.getByRole("button", { name: /login\.email_button/ }));

    expect(screen.getByText("login.error")).not.toBeNull();
    expect(screen.queryByText("Invalid password")).toBeNull();
  });
});
