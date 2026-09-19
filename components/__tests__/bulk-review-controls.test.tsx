/** @vitest-environment happy-dom */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BulkReviewControls, requestBulkReview } from "../bulk-review-controls";
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
afterEach(() => vi.unstubAllGlobals());
describe("manual bulk review", () => {
  it("sends the complete selected membership including hidden IDs and opens only a server-issued review", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ command: { id: "review-1" } }) });
    vi.stubGlobal("fetch", fetcher);
    const opened = vi.fn(); window.addEventListener("nexus:bulk-review", opened);
    const ids = Array.from({ length: 35 }, (_, i) => String(i + 1));
    await requestBulkReview("archive", { mode: "selected", applicationIds: ids });
    expect(JSON.parse(fetcher.mock.calls[0][1].body).scope.applicationIds).toEqual(ids);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect((opened.mock.calls[0][0] as CustomEvent).detail).toEqual({ commandId: "review-1" });
    window.removeEventListener("nexus:bulk-review", opened);
  });
  it("resolves all matching on the server with the current filter and shows server failures", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "Review unavailable" }) });
    vi.stubGlobal("fetch", fetcher);
    render(<BulkReviewControls selectedIds={["hidden"]} visibleIds={["visible"]} filters={{ statuses: ["interview"], workModes: ["hybrid"] }} hiddenCount={1} onClear={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "review" }));
    const body = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(body.scope.mode).toBe("all_matching");
    expect(body.scope.filters).toMatchObject({ statuses: ["interview"], workModes: ["hybrid"] });
    expect(body.scope.applicationIds).toBeUndefined();
    expect(body.changes.followUpAt).toMatch(/^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/);
    expect(screen.getByRole("alert").textContent).toBe("Review unavailable");
  });
});
