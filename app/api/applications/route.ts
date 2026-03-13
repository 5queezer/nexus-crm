import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAuth } from "@/lib/session";
import { normalizeStatus } from "@/types";

export async function GET(_request: NextRequest) {
  const auth = await requireAuth();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const applications = await getDb().listApplications(auth.readScopeUserId);
  return NextResponse.json(applications);
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { company, role, status, appliedAt, lastContact, followUpAt, notes, jobDescription, source, remote, salaryMin, salaryMax, rating } = body;

  if (!company || !role) {
    return NextResponse.json(
      { error: "company and role are required" },
      { status: 400 }
    );
  }

  const parsedSalaryMin = salaryMin != null ? parseInt(String(salaryMin), 10) : null;
  const parsedSalaryMax = salaryMax != null ? parseInt(String(salaryMax), 10) : null;

  if (parsedSalaryMin != null && parsedSalaryMax != null && parsedSalaryMin > parsedSalaryMax) {
    return NextResponse.json(
      { error: "salaryMin must not exceed salaryMax" },
      { status: 400 }
    );
  }

  const application = await getDb().createApplication(auth.userId, {
    company: String(company).slice(0, 255),
    role: String(role).slice(0, 255),
    status: normalizeStatus(status || "applied"),
    appliedAt: appliedAt ? new Date(appliedAt) : null,
    lastContact: lastContact ? new Date(lastContact) : null,
    followUpAt: followUpAt ? new Date(followUpAt) : null,
    notes: notes ? String(notes).slice(0, 10000) : null,
    jobDescription: jobDescription ? String(jobDescription).slice(0, 50000) : null,
    source: source ? String(source).slice(0, 100) : null,
    remote: !!remote,
    salaryMin: parsedSalaryMin,
    salaryMax: parsedSalaryMax,
    rating: rating != null ? Math.min(5, Math.max(1, parseInt(String(rating), 10))) : null,
  });

  return NextResponse.json(application, { status: 201 });
}
