// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OnboardingWizard } from "../onboarding-wizard";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

function renderWizard(props: Partial<React.ComponentProps<typeof OnboardingWizard>> = {}) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <OnboardingWizard
        onComplete={vi.fn()}
        onCreateDemo={vi.fn().mockResolvedValue(undefined)}
        {...props}
      />
    </QueryClientProvider>,
  );
}

async function reachFirstOpportunityStep() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "get_started" }));
  await screen.findByRole("heading", { name: "profile_title" });
  await user.type(screen.getByRole("textbox"), "Nexus");
  await user.click(screen.getByRole("button", { name: "continue" }));
  await screen.findByRole("heading", { name: "first_app_title" });
  return user;
}

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("OnboardingWizard demo workspace", () => {
  it("offers optional demo creation and completes onboarding after success", async () => {
    const onCreateDemo = vi.fn().mockResolvedValue(undefined);
    const onComplete = vi.fn();
    renderWizard({ onCreateDemo, onComplete });
    const user = await reachFirstOpportunityStep();

    await user.click(screen.getByRole("button", { name: "create_demo" }));

    await waitFor(() => expect(onCreateDemo).toHaveBeenCalledOnce());
    expect(onComplete).toHaveBeenCalledOnce();
    expect(localStorage.getItem("onboarding-complete")).toBe("true");
  });
});
