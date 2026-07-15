// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FocusQueue } from "../focus-queue";

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string) => key,
}));

describe("FocusQueue empty recovery", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
  });

  it("renders one explicit create recovery for a true-empty workspace", async () => {
    const onCreate = vi.fn();
    await act(async () => {
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <FocusQueue
            applications={[]}
            isTrueEmpty
            isFilteredEmpty={false}
            selectedIds={new Set()}
            onToggleSelect={vi.fn()}
            onOpen={vi.fn()}
            onEdit={vi.fn()}
            onDelete={vi.fn()}
            onArchive={vi.fn()}
            onCreate={onCreate}
            onClearFilters={vi.fn()}
          />
        </QueryClientProvider>,
      );
    });

    const button = container.querySelector("button");
    expect(button?.textContent).toBe("create");
    await act(async () => button?.click());
    expect(onCreate).toHaveBeenCalledOnce();
    expect(container.textContent).not.toContain("groups.overdue");
  });
});
