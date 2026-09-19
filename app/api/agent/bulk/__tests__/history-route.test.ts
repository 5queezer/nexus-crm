import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), commands: vi.fn(), cursor: vi.fn(), counts: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireSessionAuth: mocks.auth }));
vi.mock("@/lib/prisma", () => ({ prisma: { bulkCommand: { findMany: mocks.commands, findFirst: mocks.cursor }, bulkCommandItem: { groupBy: mocks.counts } } }));
import { GET } from "../route";
describe("bulk task history", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockResolvedValue({ userId: "owner", user: { isAdmin: true } }); });
  it("rejects anonymous reads", async () => {
    mocks.auth.mockResolvedValue(null);
    expect((await GET(new Request("http://local/api/agent/bulk"))).status).toBe(401);
    expect(mocks.commands).not.toHaveBeenCalled();
  });
  it("aggregates counts without loading items and never elevates admin scope", async () => {
    mocks.commands.mockResolvedValue([{ id: "task", status: "completed", actionType: "archive", createdAt: new Date() }]);
    mocks.counts.mockResolvedValueOnce([{ commandId: "task", status: "applied", _count: { _all: 35 } }]).mockResolvedValueOnce([]);
    const result = await (await GET(new Request("http://local/api/agent/bulk"))).json();
    expect(result.tasks[0]).toMatchObject({ total: 35, applied: 35, undone: 0 });
    expect(mocks.commands.mock.calls[0][0].where).toEqual({ userId: "owner" });
    expect(mocks.commands.mock.calls[0][0].select.items).toBeUndefined();
    expect(mocks.counts.mock.calls[0][0].where.userId).toBe("owner");
  });
  it("rejects foreign cursors without revealing task contents", async () => {
    mocks.cursor.mockResolvedValue(null);
    expect((await GET(new Request("http://local/api/agent/bulk?cursor=foreign"))).status).toBe(400);
    expect(mocks.commands).not.toHaveBeenCalled();
  });
});
