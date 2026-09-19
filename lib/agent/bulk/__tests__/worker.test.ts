import { describe, expect, it } from "vitest";
import { resolveWorkerAction } from "../worker";

describe("durable bulk worker control", () => {
  it("settles at item boundaries when pause or cancel is requested", () => {
    expect(resolveWorkerAction({
      status: "pause_requested",
      pending: 10,
      applied: 2,
      failed: 0,
      stale: 0,
      outcomeUnknown: 0,
    })).toBe("pause");
    expect(resolveWorkerAction({
      status: "cancel_requested",
      pending: 10,
      applied: 2,
      failed: 0,
      stale: 0,
      outcomeUnknown: 0,
    })).toBe("cancel");
  });

  it("finishes with errors when any item is stale or outcome-unknown", () => {
    expect(resolveWorkerAction({
      status: "running",
      pending: 0,
      applied: 2,
      failed: 0,
      stale: 1,
      outcomeUnknown: 0,
    })).toBe("complete_with_errors");
    expect(resolveWorkerAction({
      status: "running",
      pending: 0,
      applied: 3,
      failed: 0,
      stale: 0,
      outcomeUnknown: 0,
    })).toBe("complete");
  });

  it("expires unlaunched work before any item write", () => {
    expect(resolveWorkerAction({
      status: "running",
      pending: 3,
      applied: 0,
      failed: 0,
      stale: 0,
      outcomeUnknown: 0,
      expired: true,
    })).toBe("expire");
  });
});
