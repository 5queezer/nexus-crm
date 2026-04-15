import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaAdapter } from "../prisma-adapter";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      count: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

describe("PrismaAdapter — updateUserAdmin security", () => {
  let adapter: PrismaAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new PrismaAdapter();
  });

  it("allows granting admin status", async () => {
    const mockUser = { id: "user-1", isAdmin: true, email: "admin@example.com", name: "Admin" };
    (prisma.$transaction as any).mockImplementation(async (callback: any) => {
      return callback(prisma);
    });
    (prisma.user.update as any).mockResolvedValue(mockUser);

    const result = await adapter.updateUserAdmin("user-1", true);

    expect(result.isAdmin).toBe(true);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { isAdmin: true },
      select: { id: true, name: true, email: true, isAdmin: true },
    });
  });

  it("prevents demoting the last admin", async () => {
    (prisma.$transaction as any).mockImplementation(async (callback: any) => {
      return callback(prisma);
    });
    // Mock that there is only 1 admin
    (prisma.user.count as any).mockResolvedValue(1);
    // Mock that the user being updated IS an admin
    (prisma.user.findUnique as any).mockResolvedValue({ id: "user-1", isAdmin: true });

    await expect(adapter.updateUserAdmin("user-1", false))
      .rejects.toThrow("AT_LEAST_ONE_ADMIN_REQUIRED");

    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("allows demoting an admin if there are others", async () => {
    const mockUser = { id: "user-1", isAdmin: false, email: "user@example.com", name: "User" };
    (prisma.$transaction as any).mockImplementation(async (callback: any) => {
      return callback(prisma);
    });
    // Mock that there are 2 admins
    (prisma.user.count as any).mockResolvedValue(2);
    // Mock that the user being updated IS an admin
    (prisma.user.findUnique as any).mockResolvedValue({ id: "user-1", isAdmin: true });
    (prisma.user.update as any).mockResolvedValue(mockUser);

    const result = await adapter.updateUserAdmin("user-1", false);

    expect(result.isAdmin).toBe(false);
    expect(prisma.user.update).toHaveBeenCalled();
  });
});
