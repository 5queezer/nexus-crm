import { NextResponse } from "next/server";
import { requireSessionAuth } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const auth = await requireSessionAuth();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const cursor = new URL(request.url).searchParams.get("cursor");
  if (cursor && !(await prisma.bulkCommand.findFirst({ where: { id: cursor, userId: auth.userId }, select: { id: true } }))) return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
  const rows = await prisma.bulkCommand.findMany({
    where: { userId: auth.userId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 51,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: { id: true, actionType: true, status: true, createdAt: true },
  });
  const page = rows.slice(0, 50);
  const commandIds = page.map((row) => row.id);
  const [statusGroups, undoneGroups] = commandIds.length ? await Promise.all([
    prisma.bulkCommandItem.groupBy({
      by: ["commandId", "status"],
      where: { userId: auth.userId, commandId: { in: commandIds } },
      _count: { _all: true },
    }),
    prisma.bulkCommandItem.groupBy({
      by: ["commandId"],
      where: { userId: auth.userId, commandId: { in: commandIds }, undoStatus: "applied" },
      _count: { _all: true },
    }),
  ]) : [[], []];
  const counts = new Map<string, { total: number; applied: number; undone: number }>(
    commandIds.map((id) => [id, { total: 0, applied: 0, undone: 0 }]),
  );
  for (const group of statusGroups) {
    const count = counts.get(group.commandId)!;
    count.total += group._count._all;
    if (group.status === "applied") count.applied = group._count._all;
  }
  for (const group of undoneGroups) counts.get(group.commandId)!.undone = group._count._all;
  return NextResponse.json({
    tasks: page.map((task) => ({ ...task, ...counts.get(task.id)! })),
    nextCursor: rows.length > 50 ? rows[49].id : null,
  });
}
