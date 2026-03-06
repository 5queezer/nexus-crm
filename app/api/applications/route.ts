import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuthOrToken } from "@/lib/session";
import { userWhere, requireUserId } from "@/lib/tenant";

export async function GET(request: NextRequest) {
  const auth = await requireAuthOrToken(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const applications = await prisma.application.findMany({
    where: { ...userWhere(auth.userId) },
    orderBy: { createdAt: "desc" },
    include: { contacts: true },
  });
  return NextResponse.json(applications);
}

export async function POST(request: NextRequest) {
  const auth = await requireAuthOrToken(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let userId: string;
  try {
    userId = requireUserId(auth.userId);
  } catch {
    return NextResponse.json({ error: "Session required" }, { status: 403 });
  }

  const body = await request.json();
  const { company, role, status, appliedAt, lastContact, followUpAt, notes, jobDescription } = body;

  if (!company || !role) {
    return NextResponse.json(
      { error: "company and role are required" },
      { status: 400 }
    );
  }

  const application = await prisma.application.create({
    data: {
      userId,
      company: String(company).slice(0, 255),
      role: String(role).slice(0, 255),
      status: status || "applied",
      appliedAt: appliedAt ? new Date(appliedAt) : null,
      lastContact: lastContact ? new Date(lastContact) : null,
      followUpAt: followUpAt ? new Date(followUpAt) : null,
      notes: notes ? String(notes).slice(0, 10000) : null,
      jobDescription: jobDescription ? String(jobDescription).slice(0, 50000) : null,
    },
    include: { contacts: true },
  });

  return NextResponse.json(application, { status: 201 });
}
