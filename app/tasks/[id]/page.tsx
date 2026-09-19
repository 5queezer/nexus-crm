import { notFound, redirect } from "next/navigation";
import { requireSessionAuth } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { TaskWorkspace } from "@/components/task-workspace";

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSessionAuth();
  if (!session) redirect("/login");
  const { id } = await params;
  const command = await prisma.bulkCommand.findFirst({ where: { id, userId: session.userId }, select: { id: true } });
  if (!command) notFound();
  return <TaskWorkspace user={session.user} commandId={id} />;
}
