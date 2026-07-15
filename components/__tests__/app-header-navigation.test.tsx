/** @vitest-environment happy-dom */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppHeader } from "../app-header";

const navigation = vi.hoisted(() => ({ pathname: "/" }));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: { signOut: vi.fn() },
}));
vi.mock("../header-utility-menu", () => ({
  HeaderUtilityMenu: () => null,
}));

describe("AppHeader mobile route navigation", () => {
  beforeEach(() => {
    navigation.pathname = "/";
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
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
  });

  it("clears an open route disclosure without focus restoration or stale reopen", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <AppHeader user={{ email: "user@example.com", isAdmin: false }} />,
    );

    await user.click(screen.getByRole("button", { name: "menu" }));
    expect(screen.getByRole("dialog", { name: "navigation" })).toBeTruthy();

    navigation.pathname = "/documents";
    rerender(<AppHeader user={{ email: "user@example.com", isAdmin: false }} />);

    expect(screen.queryByRole("dialog", { name: "navigation" })).toBeNull();
    const currentTrigger = screen.getByRole("button", { name: "menu" });
    expect(document.activeElement).not.toBe(currentTrigger);

    navigation.pathname = "/";
    rerender(<AppHeader user={{ email: "user@example.com", isAdmin: false }} />);
    expect(screen.queryByRole("dialog", { name: "navigation" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "menu" }).getAttribute("aria-expanded"),
    ).toBe("false");
  });
});
