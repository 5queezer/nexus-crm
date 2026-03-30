import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAuth } from "@/lib/session";
import { normalizeStatus, normalizeSource } from "@/types";

export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const pageParam = searchParams.get("page");
  const pageSizeParam = searchParams.get("pageSize");

  // If pagination params are provided, use paginated endpoint
  if (pageParam || pageSizeParam) {
    const page = pageParam ? parseInt(pageParam, 10) : 1;
    const pageSize = pageSizeParam ? parseInt(pageSizeParam, 10) : 10;

    if (isNaN(page) || isNaN(pageSize) || page < 1 || pageSize < 1) {
      return NextResponse.json({ error: "Invalid pagination parameters" }, { status: 400 });
    }

    const result = await getDb().listApplicationsPaginated(auth.readScopeUserId, { page, pageSize });
    return NextResponse.json(result);
  }

  // Default: return all (backward compatible)
  const applications = await getDb().listApplications(auth.readScopeUserId);
  return NextResponse.json(applications);
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { company, role, status, appliedAt, lastContact, followUpAt, notes, jobDescription, source, remote, salaryMin, salaryMax, rating, jobUrl, companySize, salaryBandMentioned, triageQuality, triageReason, incomingSource, autoRejected, autoRejectReason } = body;

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
    source: normalizeSource(source),
    remote: !!remote,
    salaryMin: parsedSalaryMin,
    salaryMax: parsedSalaryMax,
    rating: rating != null ? Math.min(5, Math.max(1, parseInt(String(rating), 10))) : null,
    jobUrl: jobUrl ? String(jobUrl).slice(0, 2000) : null,
    companySize: companySize ? String(companySize).slice(0, 20) : null,
    salaryBandMentioned: !!salaryBandMentioned,
    triageQuality: triageQuality != null ? Math.min(5, Math.max(1, parseInt(String(triageQuality), 10))) : null,
    triageReason: triageReason ? String(triageReason).slice(0, 1000) : null,
    incomingSource: incomingSource ? String(incomingSource).slice(0, 20) : null,
    autoRejected: !!autoRejected,
    autoRejectReason: autoRejectReason ? String(autoRejectReason).slice(0, 1000) : null,
  });

  return NextResponse.json(application, { status: 201 });
}
