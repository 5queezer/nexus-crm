// @vitest-environment happy-dom

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BulkActionBar } from "../bulk-action-bar";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

describe("BulkActionBar status menu", () => {
  it("portals the accessible menu outside the horizontal scroller and supports keyboard selection", async () => {
    const onChangeStatus = vi.fn();
    const user = userEvent.setup();
    const { container } = render(
      <BulkActionBar
        selectedCount={2}
        hiddenSelectedCount={0}
        onChangeStatus={onChangeStatus}
        onArchive={vi.fn()}
        onDelete={vi.fn()}
        onClear={vi.fn()}
      />,
    );

    const trigger = screen.getByRole("button", { name: "change_status" });
    expect(trigger.className).toContain("nexus-target");
    await user.click(trigger);

    const menu = await screen.findByRole("menu", { name: "change_status" });
    const scroller = container.querySelector("[data-bulk-action-scroller]");
    expect(scroller?.contains(menu)).toBe(false);
    expect(menu.parentElement).toBe(document.body);

    const items = within(menu).getAllByRole("menuitem");
    await waitFor(() => expect(document.activeElement).toBe(items[0]));
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(items[1]);
    await user.keyboard("{Enter}");
    expect(onChangeStatus).toHaveBeenCalledWith("applied");
    await waitFor(() => {
      expect(screen.queryByRole("menu", { name: "change_status" })).toBeNull();
      expect(document.activeElement).toBe(trigger);
    });
  });

  it("unmounts an open portal at zero selections and reopens with closed state", async () => {
    const user = userEvent.setup();
    const props = {
      hiddenSelectedCount: 0,
      onChangeStatus: vi.fn(),
      onArchive: vi.fn(),
      onDelete: vi.fn(),
      onClear: vi.fn(),
    };
    const { rerender } = render(<BulkActionBar selectedCount={1} {...props} />);

    await user.click(screen.getByRole("button", { name: "change_status" }));
    expect(await screen.findByRole("menu", { name: "change_status" })).toBeTruthy();

    rerender(<BulkActionBar selectedCount={0} {...props} />);
    expect(screen.queryByRole("menu", { name: "change_status" })).toBeNull();
    expect(screen.queryByRole("button", { name: "change_status" })).toBeNull();

    rerender(<BulkActionBar selectedCount={1} {...props} />);
    const reopenedTrigger = screen.getByRole("button", { name: "change_status" });
    expect(reopenedTrigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("menu", { name: "change_status" })).toBeNull();
  });

  it("announces filter-hidden selections as included in bulk actions", () => {
    render(
      <BulkActionBar
        selectedCount={3}
        hiddenSelectedCount={2}
        onChangeStatus={vi.fn()}
        onArchive={vi.fn()}
        onDelete={vi.fn()}
        onClear={vi.fn()}
      />,
    );

    const disclosure = screen.getByText("hidden_included");
    expect(disclosure.getAttribute("aria-live")).toBe("polite");
  });

  it("returns focus to the trigger when Escape closes the portal", async () => {
    const user = userEvent.setup();
    render(
      <BulkActionBar
        selectedCount={1}
        hiddenSelectedCount={0}
        onChangeStatus={vi.fn()}
        onArchive={vi.fn()}
        onDelete={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    const trigger = screen.getByRole("button", { name: "change_status" });
    await user.click(trigger);
    await screen.findByRole("menu", { name: "change_status" });
    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByRole("menu", { name: "change_status" })).toBeNull();
      expect(document.activeElement).toBe(trigger);
    });
  });
});
