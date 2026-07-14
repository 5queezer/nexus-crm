import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAuth } from "@/lib/session";
import {
  validateSubmissionAnswers,
  validateSubmissionDocumentIds,
} from "@/lib/applications/submission";
import type { SubmissionPolicyInput } from "@/lib/db/types";

const SALARY_PERIODS = new Set(["hour", "day", "month", "year"]);
const SALARY_TYPES = new Set(["base", "total", "contract_rate"]);
const SUBMISSION_CONFLICT_CODES = new Set([
  "conflict",
  "idempotency_conflict",
  "application_already_submitted",
  "duplicate_requisition",
  "same_company_active_application",
]);
const SUBMISSION_CLIENT_ERROR_CODES = new Set([
  "application_deleting",
  "invalid_documents",
  "document_already_submitted",
  "human_review_required",
  "identity_consistency_required",
  "fact_verification_required",
  "profile_consistency_review_required",
  "submission_materials_required",
  "submission_answers_required",
  "submission_documents_invalid",
  "submission_policy_reason_too_long",
]);

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  try {
    const includeAnswers = request.nextUrl.searchParams.get("includeAnswers") === "true";
    const submissions = await getDb().listApplicationSubmissions(id, auth.userId, includeAnswers);
    return NextResponse.json(submissions);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  try {
    const body = await request.json() as Record<string, unknown>;
    if (
      typeof body.idempotencyKey !== "string" ||
      body.idempotencyKey.length < 8 ||
      body.idempotencyKey.length > 128
    ) {
      return NextResponse.json({ error: "idempotencyKey must contain 8-128 characters" }, { status: 400 });
    }
    const submittedAt = new Date(String(body.submittedAt ?? ""));
    if (Number.isNaN(submittedAt.getTime())) {
      return NextResponse.json({ error: "submittedAt must be a valid ISO timestamp" }, { status: 400 });
    }
    if (!Array.isArray(body.answers)) {
      return NextResponse.json({ error: "answers must be an array" }, { status: 400 });
    }
    const answers = validateSubmissionAnswers(
      body.answers as Parameters<typeof validateSubmissionAnswers>[0],
    );
    const documentIds = validateSubmissionDocumentIds(body.documentIds);
    const salaryMin = body.candidateSalaryMin == null ? null : Number(body.candidateSalaryMin);
    const salaryMax = body.candidateSalaryMax == null ? null : Number(body.candidateSalaryMax);
    if (
      salaryMin !== null &&
      (!Number.isInteger(salaryMin) || salaryMin < 0)
    ) {
      return NextResponse.json({ error: "candidateSalaryMin must be a non-negative integer" }, { status: 400 });
    }
    if (
      salaryMax !== null &&
      (!Number.isInteger(salaryMax) || salaryMax < 0)
    ) {
      return NextResponse.json({ error: "candidateSalaryMax must be a non-negative integer" }, { status: 400 });
    }
    if (salaryMin !== null && salaryMax !== null && salaryMin > salaryMax) {
      return NextResponse.json({ error: "candidateSalaryMin must not exceed candidateSalaryMax" }, { status: 400 });
    }
    const salaryCurrency = body.candidateSalaryCurrency == null
      ? null
      : String(body.candidateSalaryCurrency).trim().toUpperCase();
    if (salaryCurrency !== null && !/^[A-Z]{3}$/.test(salaryCurrency)) {
      return NextResponse.json({ error: "candidateSalaryCurrency must be an ISO 4217 code" }, { status: 400 });
    }
    const salaryPeriod = body.candidateSalaryPeriod == null
      ? null
      : String(body.candidateSalaryPeriod);
    if (salaryPeriod !== null && !SALARY_PERIODS.has(salaryPeriod)) {
      return NextResponse.json({ error: "candidateSalaryPeriod is invalid" }, { status: 400 });
    }
    const salaryType = body.candidateSalaryType == null
      ? null
      : String(body.candidateSalaryType);
    if (salaryType !== null && !SALARY_TYPES.has(salaryType)) {
      return NextResponse.json({ error: "candidateSalaryType is invalid" }, { status: 400 });
    }
    const followUpAt = body.followUpAt === undefined
      ? undefined
      : body.followUpAt === null ? null : new Date(String(body.followUpAt));
    if (followUpAt instanceof Date && Number.isNaN(followUpAt.getTime())) {
      return NextResponse.json({ error: "followUpAt must be a valid ISO timestamp" }, { status: 400 });
    }
    const expectedUpdatedAt = body.expectedUpdatedAt
      ? new Date(String(body.expectedUpdatedAt))
      : undefined;
    if (expectedUpdatedAt && Number.isNaN(expectedUpdatedAt.getTime())) {
      return NextResponse.json({ error: "expectedUpdatedAt must be a valid ISO timestamp" }, { status: 400 });
    }
    const applicationUrl = body.applicationUrl == null
      ? null
      : String(body.applicationUrl).trim();
    if (applicationUrl) {
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(applicationUrl);
      } catch {
        return NextResponse.json({ error: "applicationUrl must be a valid URL" }, { status: 400 });
      }
      if (!new Set(["http:", "https:"]).has(parsedUrl.protocol)) {
        return NextResponse.json({ error: "applicationUrl must use HTTP or HTTPS" }, { status: 400 });
      }
    }
    const atsName = body.atsName === undefined
      ? undefined
      : body.atsName === null ? null : String(body.atsName).slice(0, 100);
    const requisitionId = body.requisitionId === undefined
      ? undefined
      : body.requisitionId === null ? null : String(body.requisitionId).slice(0, 255);
    const policy = body.policy === undefined
      ? undefined
      : body.policy === null ? null : body.policy as SubmissionPolicyInput;
    const result = await getDb().recordApplicationSubmission(auth.userId, {
      applicationId: id,
      idempotencyKey: body.idempotencyKey,
      submittedAt,
      followUpAt,
      applicationUrl: applicationUrl?.slice(0, 2000) ?? null,
      atsName,
      requisitionId,
      language: body.language == null ? null : String(body.language).slice(0, 20),
      answers,
      policy,
      candidateSalaryMin: salaryMin,
      candidateSalaryMax: salaryMax,
      candidateSalaryCurrency: salaryCurrency,
      candidateSalaryPeriod: salaryPeriod,
      candidateSalaryType: salaryType,
      candidateSalaryFlexible: body.candidateSalaryFlexible === true,
      documentIds,
      expectedUpdatedAt,
      dryRun: body.dryRun === true,
      source: "rest",
      actor: auth.user.email,
    });
    return NextResponse.json(result, { status: result.dryRun || result.replayed ? 200 : 201 });
  } catch (error) {
    const rawCode = error instanceof Error ? error.message : "submission_failed";
    if (rawCode === "not_found") {
      return NextResponse.json({ error: rawCode }, { status: 404 });
    }
    if (SUBMISSION_CONFLICT_CODES.has(rawCode)) {
      return NextResponse.json({ error: rawCode }, { status: 409 });
    }
    if (SUBMISSION_CLIENT_ERROR_CODES.has(rawCode)) {
      return NextResponse.json({ error: rawCode }, { status: 400 });
    }
    const code = rawCode === "verification_failed" ? rawCode : "submission_failed";
    return NextResponse.json({ error: code }, { status: 500 });
  }
}
