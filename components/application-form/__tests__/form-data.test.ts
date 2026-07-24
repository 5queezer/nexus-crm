import { afterEach, describe, expect, it, vi } from "vitest";
import { updateApplication, type ApplicationFormData } from "../form-data";

describe("updateApplication", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("omits lifecycle fields that the edit form cannot mutate", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ application: { id: "app-1" } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const data = {
      company: "Acme",
      role: "Engineer",
      status: "interview",
      appliedAt: "2026-07-01",
      lastContact: "2026-07-10",
      followUpAt: "2026-07-30",
      notes: "summary",
    } as ApplicationFormData;

    await updateApplication("app-1", data, "2026-07-24T08:00:00.000Z");

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).toMatchObject({
      company: "Acme",
      role: "Engineer",
      notes: "summary",
      expectedUpdatedAt: "2026-07-24T08:00:00.000Z",
    });
    expect(body).not.toHaveProperty("status");
    expect(body).not.toHaveProperty("appliedAt");
    expect(body).not.toHaveProperty("lastContact");
    expect(body).not.toHaveProperty("followUpAt");
  });
});
