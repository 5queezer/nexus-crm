import { beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => {
  const calls: string[] = [];
  const transaction = {
    $queryRaw: vi.fn(async () => [{ id: "owner-1" }]),
    demoWorkspace: {
      findUnique: vi.fn(async () => ({ id: 7, userId: "owner-1" })),
      delete: vi.fn(async () => { calls.push("workspace.delete"); }),
    },
    application: {
      count: vi.fn(async () => 2),
    },
    applicationEvent: {
      count: vi.fn(async () => 3),
    },
    document: {
      updateMany: vi.fn(async () => {
        calls.push("document.updateMany");
        return { count: 1 };
      }),
    },
  };
  const prisma = {
    $transaction: vi.fn(async (callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction)),
  };
  return { calls, transaction, prisma };
});

vi.mock("@/lib/prisma", () => ({ prisma: fake.prisma }));

import { PrismaAdapter } from "../prisma-adapter";

describe("PrismaAdapter — demo workspace deletion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fake.calls.length = 0;
  });

  it("marks submission-linked documents historical before cascading the workspace", async () => {
    const adapter = new PrismaAdapter();

    await expect(adapter.deleteDemoWorkspace("owner-1")).resolves.toEqual({
      deletedApplications: 2,
      deletedEvents: 3,
    });

    expect(fake.transaction.document.updateMany).toHaveBeenCalledWith({
      where: {
        userId: "owner-1",
        submission: {
          application: {
            userId: "owner-1",
            demoWorkspaceId: 7,
            isDemo: true,
          },
        },
      },
      data: { state: "historical" },
    });
    expect(fake.calls).toEqual(["document.updateMany", "workspace.delete"]);
  });
});
