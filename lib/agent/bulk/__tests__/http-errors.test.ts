import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/session", () => ({ requireSessionAuth: vi.fn() }));
import { bulkErrorResponse } from "../http";
describe("bulk error disclosure", () => {
  it("does not expose driver diagnostics containing reviewed values", async () => {
    const response = bulkErrorResponse(new Error("Invalid invocation\nSQL input: secret-value"));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("secret-value");
  });
  it("still explains a domain version conflict", async () => {
    const response = bulkErrorResponse(new Error("Bulk preview changed or is unavailable"));
    expect([404, 409]).toContain(response.status);
    expect(await response.text()).toContain("Bulk preview changed");
  });
});
