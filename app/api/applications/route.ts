import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuthOrToken } from "@/lib/session";

export async function GET(request: NextRequest) {
  const session = await requireAuthOrToken(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const applications = await prisma.application.findMany({
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(applications);
}

export async function POST(request: NextRequest) {
  const session = await requireAuthOrToken(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { company, role, status, appliedAt, lastContact, followUpAt, notes } = body;

  if (!company || !role) {
    return NextResponse.json(
      { error: "company and role are required" },
      { status: 400 }
    );
  }

  const application = await prisma.application.create({
    data: {
      company: String(company).slice(0, 255),
      role: String(role).slice(0, 255),
      status: status || "applied",
      appliedAt: appliedAt ? new Date(appliedAt) : null,
      lastContact: lastContact ? new Date(lastContact) : null,
      followUpAt: followUpAt ? new Date(followUpAt) : null,
      notes: notes ? String(notes).slice(0, 10000) : null,
    },
  });

  return NextResponse.json(application, { status: 201 });
}
