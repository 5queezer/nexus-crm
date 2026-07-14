import { NextRequest } from "next/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod/v3";
import { getDb } from "@/lib/db";
import { hashApiToken } from "@/lib/token";
import { prisma } from "@/lib/prisma";
import { normalizeStatus } from "@/types";
import { resolveAppliedAtForCreate } from "@/lib/applications/defaults";
import {
  canonicalizeJobUrl,
  computeApplicationHealth,
  requireOccurredAtForIdempotency,
  validateEventMetadata,
  validateSubmissionAnswers,
  validateSubmissionPolicy,
} from "@/lib/applications/submission";
import { parseStructuredApplicationMetadata } from "@/lib/applications/metadata";
import { verifyMcpAccessToken } from "@/lib/mcp-oauth";
import { generateAndStoreCv } from "@/lib/cv/generate";
import { downloadDocumentContent } from "@/lib/documents/download";
import {
  isSubmissionDocument,
  requiresSubmissionScopeForDocumentMutation,
} from "@/lib/documents/access";
import { uploadDocumentContent, MAX_DOCUMENT_BASE64_SIZE } from "@/lib/documents/upload";
import { deleteDocumentWithContent } from "@/lib/documents/service";
import type { SessionAuthResult, SessionUser } from "@/lib/session";
import type { UpsertCvProfileInput } from "@/lib/db/types";

const structuredApplicationToolFields = {
  workMode: z.enum(["remote", "hybrid", "onsite", "flexible"]).nullable().optional(),
  eligibleCountries: z.array(z.string().length(2)).max(50).optional(),
  primaryLocations: z.array(z.string().max(200)).max(50).optional(),
  officeDaysMin: z.number().int().min(0).max(7).nullable().optional(),
  travelPercent: z.number().int().min(0).max(100).nullable().optional(),
  visaSponsorship: z.boolean().nullable().optional(),
  rightToWorkRequired: z.boolean().nullable().optional(),
  timezoneOverlap: z.string().max(255).nullable().optional(),
  salaryCurrency: z.string().length(3).nullable().optional(),
  salaryPeriod: z.enum(["year", "month", "day", "hour"]).nullable().optional(),
  salaryType: z.enum(["base", "total", "contract_rate"]).nullable().optional(),
  atsName: z.string().max(100).nullable().optional(),
  requisitionId: z.string().max(255).nullable().optional(),
  jobCapturedAt: z.string().datetime().nullable().optional(),
  jobVerifiedAt: z.string().datetime().nullable().optional(),
  jobPostedAt: z.string().datetime().nullable().optional(),
  jobClosedAt: z.string().datetime().nullable().optional(),
  jobContentHash: z.string().max(64).nullable().optional(),
  jobLiveness: z.enum(["unknown", "live", "closed", "expired"]).nullable().optional(),
  jobSummary: z.string().max(10_000).nullable().optional(),
  currentStage: z.string().max(255).nullable().optional(),
};

const APPLICATION_UPDATE_ERROR_CODES = new Set([
  "not_found",
  "conflict",
  "canonical_job_url_conflict",
  "application_deleting",
]);
const SUBMISSION_ERROR_CODES = new Set([
  "salary_range_invalid",
  "not_found",
  "conflict",
  "application_deleting",
  "idempotency_conflict",
  "invalid_documents",
  "document_already_submitted",
  "human_review_required",
  "identity_consistency_required",
  "fact_verification_required",
  "profile_consistency_review_required",
  "submission_materials_required",
  "submission_answers_required",
  "submission_policy_reason_too_long",
  "application_already_submitted",
  "duplicate_requisition",
  "same_company_active_application",
  "verification_failed",
]);

function controlledErrorCode(error: unknown, allowed: Set<string>, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return allowed.has(error.message) ? error.message : fallback;
}

// ── Auth helper ──────────────────────────────────────────────────────────────
// Tries MCP OAuth access token first, then falls back to CRM API token.

async function authenticateFromRequest(
  req: NextRequest
): Promise<SessionAuthResult | null> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const raw = authHeader.slice(7).trim();
  if (!raw) return null;

  // 1. Try MCP OAuth access token (mcp_at_ prefix)
  if (raw.startsWith("mcp_at_")) {
    return verifyMcpAccessToken(raw);
  }

  // 2. Fall back to CRM API token (jt_ prefix)
  const hash = hashApiToken(raw);
  const token = await getDb().getApiTokenByHash(hash);
  if (!token) return null;

  const user = await prisma.user.findUnique({
    where: { id: token.userId },
    select: { id: true, name: true, email: true, image: true, isAdmin: true },
  });
  if (!user) return null;

  getDb().touchApiTokenLastUsed(token.id).catch(() => {});

  const sessionUser: SessionUser = {
    id: user.id,
    name: user.name ?? null,
    email: user.email,
    image: user.image ?? null,
    isAdmin: user.isAdmin,
  };

  return {
    userId: user.id,
    readScopeUserId: user.isAdmin ? null : user.id,
    user: sessionUser,
    authType: "api_token",
    scopes: ["mcp:tools", "mcp:submissions"],
  };
}

// ── MCP server factory ──────────────────────────────────────────────────────

function createMcpServer(auth: SessionAuthResult): McpServer {
  const server = new McpServer(
    { name: "nexus-crm", version: "1.0.0" },
    {
      capabilities: { tools: {} },
      instructions:
        "Nexus CRM MCP Server – manage job applications, contacts, and documents. " +
        "All operations are scoped to the authenticated user.",
    }
  );

  const canAccessSubmissions =
    auth.authType !== "mcp_oauth" || auth.scopes?.includes("mcp:submissions") === true;
  const submissionScopeError = () => ({
    content: [{ type: "text" as const, text: JSON.stringify({ error: { code: "insufficient_scope", required: "mcp:submissions" } }) }],
    isError: true,
  });


  // ── Applications ────────────────────────────────────────────────────────

  server.tool(
    "list_applications",
    "List all job applications for the authenticated user",
    {},
    async () => {
      const apps = await getDb().listApplications(auth.readScopeUserId);
      return {
        content: [{ type: "text", text: JSON.stringify(apps, null, 2) }],
      };
    }
  );

  server.tool(
    "get_application",
    "Get a single application by ID",
    { id: z.string().describe("Application ID") },
    async ({ id }) => {
      const app = await getDb().getApplication(id, auth.readScopeUserId);
      if (!app) {
        return {
          content: [{ type: "text", text: "Application not found" }],
          isError: true,
        };
      }
      return {
        content: [{ type: "text", text: JSON.stringify(app, null, 2) }],
      };
    }
  );

  server.tool(
    "create_application",
    "Create a new job application. Supports linking a Reactive Resume via resumeId.",
    {
      company: z.string().describe("Company name"),
      role: z.string().describe("Job role/title"),
      status: z
        .enum(["inbound", "applied", "interview", "offer", "rejected"])
        .optional()
        .describe("Application status (default: inbound)"),
      appliedAt: z
        .string()
        .optional()
        .describe("Date applied (ISO 8601)"),
      lastContact: z.string().datetime().nullable().optional().describe("Last contact timestamp"),
      followUpAt: z.string().datetime().nullable().optional().describe("Follow-up timestamp"),
      notes: z.string().optional().describe("Free-text notes"),
      jobDescription: z
        .string()
        .optional()
        .describe("Job description text"),
      source: z.string().optional().describe("Source (linkedin, referral, etc.)"),
      remote: z.boolean().optional().describe("Remote position?"),
      salaryMin: z.number().optional().describe("Minimum salary"),
      salaryMax: z.number().optional().describe("Maximum salary"),
      rating: z.number().int().min(1).max(5).nullable().optional().describe("Fit rating 1-5"),
      jobUrl: z.string().optional().describe("URL to job listing or opportunity page"),
      resumeId: z.string().nullable().optional().describe("Reactive Resume resume ID"),
      ...structuredApplicationToolFields,
    },
    async (args) => {
      const metadata = parseStructuredApplicationMetadata(args as unknown as Record<string, unknown>);
      const app = await getDb().createApplication(auth.userId, {
        company: args.company.slice(0, 255),
        role: args.role.slice(0, 255),
        status: normalizeStatus(args.status || "inbound"),
        appliedAt: resolveAppliedAtForCreate(args.status || "inbound", args.appliedAt),
        lastContact: args.lastContact ? new Date(args.lastContact) : null,
        followUpAt: args.followUpAt ? new Date(args.followUpAt) : null,
        notes: args.notes?.slice(0, 10000) ?? null,
        jobDescription: args.jobDescription?.slice(0, 50000) ?? null,
        source: args.source?.slice(0, 100) ?? null,
        remote: args.remote ?? false,
        salaryMin: args.salaryMin ?? null,
        salaryMax: args.salaryMax ?? null,
        rating: args.rating ?? null,
        jobUrl: args.jobUrl?.slice(0, 2000) ?? null,
        resumeId: args.resumeId ?? null,
        ...metadata,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(app, null, 2) }],
      };
    }
  );

  server.tool(
    "update_application",
    "Update an existing application. Supports linking a Reactive Resume via resumeId.",
    {
      id: z.string().describe("Application ID"),
      company: z.string().optional().describe("Company name"),
      role: z.string().optional().describe("Job role/title"),
      status: z
        .enum(["inbound", "applied", "interview", "offer", "rejected"])
        .optional()
        .describe("Application status"),
      appliedAt: z.string().nullable().optional().describe("Date applied (ISO 8601)"),
      lastContact: z.string().nullable().optional().describe("Last contact date"),
      followUpAt: z.string().nullable().optional().describe("Follow-up date"),
      notes: z.string().nullable().optional().describe("Free-text notes"),
      jobDescription: z.string().nullable().optional().describe("Job description"),
      source: z.string().nullable().optional().describe("Source"),
      remote: z.boolean().optional().describe("Remote position?"),
      salaryMin: z.number().nullable().optional().describe("Minimum salary"),
      salaryMax: z.number().nullable().optional().describe("Maximum salary"),
      rating: z.number().min(1).max(5).nullable().optional().describe("Rating 1-5"),
      jobUrl: z.string().nullable().optional().describe("URL to job listing or opportunity page"),
      resumeId: z.string().nullable().optional().describe("Reactive Resume resume ID"),
      expectedUpdatedAt: z.string().datetime().optional().describe("Optimistic concurrency timestamp"),
      dryRun: z.boolean().default(false).describe("Validate and preview without writing"),
      ...structuredApplicationToolFields,
    },
    async ({ id, ...data }) => {
      try {
        const update: Record<string, unknown> = {};
        if (data.company !== undefined) update.company = data.company.slice(0, 255);
        if (data.role !== undefined) update.role = data.role.slice(0, 255);
        if (data.status !== undefined) update.status = normalizeStatus(data.status);
        if (data.appliedAt !== undefined)
          update.appliedAt = data.appliedAt ? new Date(data.appliedAt) : null;
        if (data.lastContact !== undefined)
          update.lastContact = data.lastContact ? new Date(data.lastContact) : null;
        if (data.followUpAt !== undefined)
          update.followUpAt = data.followUpAt ? new Date(data.followUpAt) : null;
        if (data.notes !== undefined) update.notes = data.notes?.slice(0, 10000) ?? null;
        if (data.jobDescription !== undefined)
          update.jobDescription = data.jobDescription?.slice(0, 50000) ?? null;
        if (data.source !== undefined) update.source = data.source?.slice(0, 100) ?? null;
        if (data.remote !== undefined) update.remote = data.remote;
        if (data.salaryMin !== undefined) update.salaryMin = data.salaryMin;
        if (data.salaryMax !== undefined) update.salaryMax = data.salaryMax;
        if (data.rating !== undefined) update.rating = data.rating;
        if (data.jobUrl !== undefined) update.jobUrl = data.jobUrl?.slice(0, 2000) ?? null;
        if (data.resumeId !== undefined) update.resumeId = data.resumeId ?? null;
        Object.assign(
          update,
          parseStructuredApplicationMetadata(data as unknown as Record<string, unknown>),
        );
        if (data.expectedUpdatedAt !== undefined) {
          update.expectedUpdatedAt = new Date(data.expectedUpdatedAt);
        }

        if (data.dryRun) {
          const current = await getDb().getApplication(id, auth.userId);
          if (!current) throw new Error("not_found");
          if (
            data.expectedUpdatedAt &&
            current.updatedAt.getTime() !== new Date(data.expectedUpdatedAt).getTime()
          ) throw new Error("conflict");
          const previewUpdate = { ...update };
          delete previewUpdate.expectedUpdatedAt;
          return {
            content: [{
              type: "text",
              text: JSON.stringify({ dryRun: true, application: { ...current, ...previewUpdate } }, null, 2),
            }],
          };
        }
        const app = await getDb().updateApplication(id, auth.userId, update);
        return {
          content: [{ type: "text", text: JSON.stringify(app, null, 2) }],
        };
      } catch (error) {
        const code = controlledErrorCode(
          error,
          APPLICATION_UPDATE_ERROR_CODES,
          "application_update_failed",
        );
        return {
          content: [{ type: "text", text: JSON.stringify({ error: { code } }) }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "delete_application",
    "Delete an application and its contacts, submissions, and timeline events",
    { id: z.string().describe("Application ID") },
    async ({ id }) => {
      if (!canAccessSubmissions) return submissionScopeError();
      try {
        await getDb().deleteApplication(id, auth.userId);
        return { content: [{ type: "text", text: "Application deleted" }] };
      } catch {
        return {
          content: [{ type: "text", text: "Application not found or access denied" }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "record_application_submission",
    "Atomically preserve the exact submitted answers, required document versions, and application-integrity attestation; block duplicate/repeat/same-company conflicts unless a reasoned override applies; set the application to applied; append an event; and verify the stored package. Idempotency key and human review required.",
    {
      applicationId: z.string().min(1).describe("Application ID"),
      submittedAt: z.string().datetime().describe("Exact submission time as ISO 8601"),
      followUpAt: z.string().datetime().nullable().optional().describe("Optional follow-up time"),
      idempotencyKey: z.string().min(8).max(128).describe("Stable retry key for this submission"),
      applicationUrl: z.string().url().max(2000).nullable().optional(),
      atsName: z.string().max(100).nullable().optional(),
      requisitionId: z.string().max(255).nullable().optional(),
      language: z.string().max(20).nullable().optional(),
      answers: z.array(z.object({
        key: z.string().max(255).optional(),
        question: z.string().min(1).max(2000),
        answer: z.string().max(20000),
        kind: z.enum(["text", "boolean", "number", "choice", "salary", "other"]).optional(),
        sensitive: z.boolean().optional(),
      })).max(50).default([]),
      policy: z.object({
        humanReviewed: z.boolean().describe("Final external form and package were reviewed by Christian"),
        identityConsistent: z.boolean().describe("Name, email, phone, location, and LinkedIn identity are consistent"),
        factsVerified: z.boolean().describe("Chronology, education, certificates, languages, claims, and metrics are verified"),
        profileConsistencyStatus: z.enum(["verified", "unavailable_reviewed"]),
        confirmedNoAnswers: z.boolean().optional(),
        sameCompanyOverrideReason: z.string().min(1).max(1000).optional(),
        resubmissionReason: z.string().min(1).max(1000).optional(),
      }).describe("Required application-integrity attestation; overrides require an audited reason"),
      candidateSalaryMin: z.number().int().nonnegative().nullable().optional(),
      candidateSalaryMax: z.number().int().nonnegative().nullable().optional(),
      candidateSalaryCurrency: z.string().length(3).nullable().optional(),
      candidateSalaryPeriod: z.enum(["hour", "day", "month", "year"]).nullable().optional(),
      candidateSalaryType: z.enum(["base", "total", "contract_rate"]).nullable().optional(),
      candidateSalaryFlexible: z.boolean().optional(),
      documentIds: z.array(z.string().min(1)).min(1).max(20),
      expectedUpdatedAt: z.string().datetime().optional().describe("Optimistic concurrency timestamp"),
      dryRun: z.boolean().default(false),
    },
    async (args) => {
      if (!canAccessSubmissions) return submissionScopeError();
      try {
        if (
          args.candidateSalaryMin != null &&
          args.candidateSalaryMax != null &&
          args.candidateSalaryMin > args.candidateSalaryMax
        ) throw new Error("salary_range_invalid");
        const answers = validateSubmissionAnswers(args.answers);
        const policy = validateSubmissionPolicy({
          policy: args.policy,
          answers,
          documentIds: args.documentIds,
        });
        const result = await getDb().recordApplicationSubmission(auth.userId, {
          applicationId: args.applicationId,
          submittedAt: new Date(args.submittedAt),
          followUpAt: args.followUpAt === undefined
            ? undefined
            : args.followUpAt === null ? null : new Date(args.followUpAt),
          idempotencyKey: args.idempotencyKey,
          applicationUrl: args.applicationUrl,
          atsName: args.atsName,
          requisitionId: args.requisitionId,
          language: args.language,
          answers,
          policy,
          candidateSalaryMin: args.candidateSalaryMin,
          candidateSalaryMax: args.candidateSalaryMax,
          candidateSalaryCurrency: args.candidateSalaryCurrency?.toUpperCase() ?? args.candidateSalaryCurrency,
          candidateSalaryPeriod: args.candidateSalaryPeriod,
          candidateSalaryType: args.candidateSalaryType,
          candidateSalaryFlexible: args.candidateSalaryFlexible,
          documentIds: args.documentIds,
          expectedUpdatedAt: args.expectedUpdatedAt ? new Date(args.expectedUpdatedAt) : undefined,
          dryRun: args.dryRun,
          source: "mcp",
          actor: auth.user.email,
        });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        const code = controlledErrorCode(error, SUBMISSION_ERROR_CODES, "submission_failed");
        return { content: [{ type: "text", text: JSON.stringify({ error: { code } }) }], isError: true };
      }
    },
  );

  server.tool(
    "list_application_submissions",
    "List submission summaries for one application. Answers are excluded by default because they may contain sensitive personal data.",
    { applicationId: z.string().min(1) },
    async ({ applicationId }) => {
      if (!canAccessSubmissions) return submissionScopeError();
      try {
        const submissions = await getDb().listApplicationSubmissions(applicationId, auth.userId, false);
        return { content: [{ type: "text", text: JSON.stringify(submissions, null, 2) }] };
      } catch {
        return { content: [{ type: "text", text: "Application not found or access denied" }], isError: true };
      }
    },
  );

  server.tool(
    "get_application_submission",
    "Get one owner-scoped submission including its exact answers and submitted documents. Treat the response as sensitive.",
    { id: z.string().min(1).describe("Submission ID") },
    async ({ id }) => {
      if (!canAccessSubmissions) return submissionScopeError();
      const submission = await getDb().getApplicationSubmission(id, auth.userId);
      if (!submission) return { content: [{ type: "text", text: "Submission not found" }], isError: true };
      return { content: [{ type: "text", text: JSON.stringify(submission, null, 2) }] };
    },
  );

  server.tool(
    "append_application_note",
    "Append a note without a read-modify-write race and add an immutable note_added timeline event.",
    {
      applicationId: z.string().min(1),
      note: z.string().trim().min(1).max(5000),
      occurredAt: z.string().datetime().describe("Stable event timestamp required for idempotent retries"),
      idempotencyKey: z.string().min(8).max(128),
      expectedUpdatedAt: z.string().datetime().optional(),
    },
    async (args) => {
      try {
        const result = await getDb().appendApplicationNote(
          args.applicationId,
          auth.userId,
          args.note,
          {
            type: "note_added",
            idempotencyKey: args.idempotencyKey,
            expectedUpdatedAt: args.expectedUpdatedAt ? new Date(args.expectedUpdatedAt) : undefined,
            occurredAt: new Date(args.occurredAt),
            source: "mcp",
            actor: auth.user.email,
            metadata: {},
          },
        );
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        const code = error instanceof Error ? error.message : "append_failed";
        return { content: [{ type: "text", text: JSON.stringify({ error: { code } }) }], isError: true };
      }
    },
  );

  server.tool(
    "record_application_event",
    "Append an immutable owner-scoped application timeline event.",
    {
      applicationId: z.string().min(1),
      type: z.string().trim().min(1).max(100),
      idempotencyKey: z.string().min(8).max(128).optional(),
      occurredAt: z.string().datetime().optional(),
      metadata: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
    },
    async (args) => {
      if (args.type === "application_submitted" && !canAccessSubmissions) return submissionScopeError();
      try {
        requireOccurredAtForIdempotency(args.idempotencyKey, args.occurredAt);
        const event = await getDb().createApplicationEvent(args.applicationId, auth.userId, {
          type: args.type,
          idempotencyKey: args.idempotencyKey,
          occurredAt: args.occurredAt ? new Date(args.occurredAt) : new Date(),
          source: "mcp",
          actor: auth.user.email,
          metadata: validateEventMetadata(args.metadata),
        });
        return { content: [{ type: "text", text: JSON.stringify(event, null, 2) }] };
      } catch (error) {
        const code = error instanceof Error ? error.message : "event_failed";
        return { content: [{ type: "text", text: JSON.stringify({ error: { code } }) }], isError: true };
      }
    },
  );

  server.tool(
    "list_application_events",
    "List immutable timeline events for an application, newest first.",
    {
      applicationId: z.string().min(1),
      limit: z.number().int().min(1).max(500).default(100),
    },
    async ({ applicationId, limit }) => {
      if (!canAccessSubmissions) return submissionScopeError();
      try {
        const events = await getDb().listApplicationEvents(applicationId, auth.userId, limit);
        return { content: [{ type: "text", text: JSON.stringify(events, null, 2) }] };
      } catch {
        return { content: [{ type: "text", text: "Application not found or access denied" }], isError: true };
      }
    },
  );

  server.tool(
    "get_interview_recall_package",
    "Return the job description, exact submitted answers, timeline, and submitted documents for interview preparation. Owner-scoped sensitive response.",
    { applicationId: z.string().min(1) },
    async ({ applicationId }) => {
      if (!canAccessSubmissions) return submissionScopeError();
      const db = getDb();
      const application = await db.getApplication(applicationId, auth.userId);
      if (!application) return { content: [{ type: "text", text: "Application not found" }], isError: true };
      const [submissions, events, documents] = await Promise.all([
        db.listApplicationSubmissions(applicationId, auth.userId, true),
        db.listApplicationEvents(applicationId, auth.userId, 500),
        db.listDocumentsByApplication(applicationId, auth.userId),
      ]);
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ application, submissions, events, documents }, null, 2),
        }],
      };
    },
  );

  server.tool(
    "find_application_by_job_url",
    "Find an exact owner-scoped duplicate using a canonicalized job URL.",
    { jobUrl: z.string().url().max(2000) },
    async ({ jobUrl }) => {
      const canonicalJobUrl = canonicalizeJobUrl(jobUrl);
      if (!canonicalJobUrl) return { content: [{ type: "text", text: "Invalid URL" }], isError: true };
      const application = await getDb().findApplicationByCanonicalJobUrl(auth.userId, canonicalJobUrl);
      return { content: [{ type: "text", text: JSON.stringify({ canonicalJobUrl, application }, null, 2) }] };
    },
  );

  server.tool(
    "upsert_application_by_job_url",
    "Create or update one opportunity using an exact canonical job URL, avoiding duplicate records.",
    {
      company: z.string().min(1).max(255),
      role: z.string().min(1).max(255),
      jobUrl: z.string().url().max(2000),
      status: z.enum(["inbound", "applied", "interview", "offer", "rejected"]).optional(),
      notes: z.string().max(10_000).nullable().optional(),
      jobDescription: z.string().max(50_000).nullable().optional(),
      source: z.string().max(100).nullable().optional(),
      remote: z.boolean().optional(),
      salaryMin: z.number().int().nullable().optional(),
      salaryMax: z.number().int().nullable().optional(),
      rating: z.number().int().min(1).max(5).nullable().optional(),
      resumeId: z.string().max(255).nullable().optional(),
      dryRun: z.boolean().default(false),
      ...structuredApplicationToolFields,
    },
    async (args) => {
      try {
        const canonicalJobUrl = canonicalizeJobUrl(args.jobUrl);
        if (!canonicalJobUrl) throw new Error("job_url_invalid");
        if (args.salaryMin != null && args.salaryMax != null && args.salaryMin > args.salaryMax) {
          throw new Error("salary_range_invalid");
        }
        const db = getDb();
        const existing = await db.findApplicationByCanonicalJobUrl(auth.userId, canonicalJobUrl);
        const metadata = parseStructuredApplicationMetadata(args as unknown as Record<string, unknown>);
        const updateExisting = (applicationId: string) => db.updateApplication(applicationId, auth.userId, {
          company: args.company,
          role: args.role,
          ...(args.status !== undefined && { status: args.status }),
          ...(args.notes !== undefined && { notes: args.notes }),
          ...(args.jobDescription !== undefined && { jobDescription: args.jobDescription }),
          ...(args.source !== undefined && { source: args.source }),
          ...(args.remote !== undefined && { remote: args.remote }),
          ...(args.salaryMin !== undefined && { salaryMin: args.salaryMin }),
          ...(args.salaryMax !== undefined && { salaryMax: args.salaryMax }),
          ...(args.rating !== undefined && { rating: args.rating }),
          ...(args.resumeId !== undefined && { resumeId: args.resumeId }),
          jobUrl: args.jobUrl,
          canonicalJobUrl,
          ...metadata,
        });
        if (args.dryRun) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                dryRun: true,
                operation: existing ? "update" : "create",
                canonicalJobUrl,
                existingId: existing?.id ?? null,
              }, null, 2),
            }],
          };
        }
        if (existing) {
          const application = await updateExisting(existing.id);
          return { content: [{ type: "text", text: JSON.stringify({ operation: "updated", application }, null, 2) }] };
        }
        const status = args.status ?? "inbound";
        let operation = "created";
        let application;
        try {
          application = await db.createApplication(auth.userId, {
          company: args.company,
          role: args.role,
          status,
          appliedAt: resolveAppliedAtForCreate(status, undefined),
          lastContact: null,
          followUpAt: null,
          notes: args.notes ?? null,
          jobDescription: args.jobDescription ?? null,
          source: args.source ?? null,
          remote: args.remote ?? false,
          salaryMin: args.salaryMin ?? null,
          salaryMax: args.salaryMax ?? null,
          rating: args.rating ?? null,
          jobUrl: args.jobUrl,
          canonicalJobUrl,
          resumeId: args.resumeId ?? null,
          ...metadata,
          });
        } catch (error) {
          const code = error instanceof Error ? error.message : "";
          if (code !== "canonical_job_url_conflict") throw error;
          const concurrent = await db.findApplicationByCanonicalJobUrl(auth.userId, canonicalJobUrl);
          if (!concurrent) throw error;
          application = await updateExisting(concurrent.id);
          operation = "updated";
        }
        return { content: [{ type: "text", text: JSON.stringify({ operation, application }, null, 2) }] };
      } catch (error) {
        const code = error instanceof Error ? error.message : "upsert_failed";
        return { content: [{ type: "text", text: JSON.stringify({ error: { code } }) }], isError: true };
      }
    },
  );

  server.tool(
    "pipeline_healthcheck",
    "Return deterministic pipeline data-quality findings without modifying records.",
    {},
    async () => {
      if (!canAccessSubmissions) return submissionScopeError();
      const db = getDb();
      const [applications, submissions, documents] = await Promise.all([
        db.listApplications(auth.userId),
        db.listUserSubmissions(auth.userId),
        db.listDocuments(auth.userId),
      ]);
      const findings = computeApplicationHealth({
        applications,
        submissions,
        documents: documents.map((document) => ({
          id: document.id,
          applicationIds: document.applications?.map((application) => application.id) ?? [],
        })),
      });
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ healthy: findings.length === 0, findingCount: findings.length, findings }, null, 2),
        }],
      };
    },
  );

  // ── Batch & filtered operations ───────────────────────────────────────

  server.tool(
    "batch_upsert_applications",
    "Create or update multiple applications in one call. If an item has an 'id' it is updated; otherwise a new application is created. Supports linking a Reactive Resume via resumeId. Max 50 items per call.",
    {
      items: z
        .array(
          z.object({
            id: z.string().optional().describe("Application ID (omit to create new)"),
            company: z.string().optional().describe("Company name (required for new)"),
            role: z.string().optional().describe("Job role/title (required for new)"),
            status: z
              .enum(["inbound", "applied", "interview", "offer", "rejected"])
              .optional()
              .describe("Application status"),
            appliedAt: z.string().nullable().optional().describe("Date applied (ISO 8601)"),
            lastContact: z.string().nullable().optional().describe("Last contact date"),
            followUpAt: z.string().nullable().optional().describe("Follow-up date"),
            notes: z.string().nullable().optional().describe("Free-text notes"),
            jobDescription: z.string().nullable().optional().describe("Job description"),
            source: z.string().nullable().optional().describe("Source"),
            remote: z.boolean().optional().describe("Remote position?"),
            salaryMin: z.number().nullable().optional().describe("Minimum salary"),
            salaryMax: z.number().nullable().optional().describe("Maximum salary"),
            rating: z.number().min(1).max(5).nullable().optional().describe("Rating 1-5"),
            jobUrl: z.string().nullable().optional().describe("URL to job listing"),
            resumeId: z.string().nullable().optional().describe("Reactive Resume resume ID"),
            ...structuredApplicationToolFields,
          })
        )
        .min(1)
        .max(50)
        .describe("Array of applications to create or update (max 50)"),
    },
    async ({ items }) => {
      try {
        const sanitized = items.map((item) => ({
          id: item.id,
          company: item.company?.slice(0, 255),
          role: item.role?.slice(0, 255),
          status: item.status,
          appliedAt: item.appliedAt !== undefined ? (item.appliedAt ? new Date(item.appliedAt) : null) : undefined,
          lastContact: item.lastContact !== undefined ? (item.lastContact ? new Date(item.lastContact) : null) : undefined,
          followUpAt: item.followUpAt !== undefined ? (item.followUpAt ? new Date(item.followUpAt) : null) : undefined,
          notes: item.notes !== undefined ? (item.notes?.slice(0, 10000) ?? null) : undefined,
          jobDescription: item.jobDescription !== undefined ? (item.jobDescription?.slice(0, 50000) ?? null) : undefined,
          source: item.source !== undefined ? (item.source?.slice(0, 100) ?? null) : undefined,
          remote: item.remote,
          salaryMin: item.salaryMin,
          salaryMax: item.salaryMax,
          rating: item.rating,
          jobUrl: item.jobUrl !== undefined ? (item.jobUrl?.slice(0, 2000) ?? null) : undefined,
          resumeId: item.resumeId !== undefined ? (item.resumeId ?? null) : undefined,
          ...parseStructuredApplicationMetadata(item as unknown as Record<string, unknown>),
        }));

        const result = await getDb().batchUpsertApplications(auth.userId, sanitized);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch {
        return {
          content: [{ type: "text", text: "Batch upsert failed" }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "batch_delete_applications",
    "Delete multiple applications and their contacts in one call. Max 50 IDs per call.",
    {
      ids: z
        .array(z.string())
        .min(1)
        .max(50)
        .describe("Array of application IDs to delete (max 50)"),
    },
    async ({ ids }) => {
      if (!canAccessSubmissions) return submissionScopeError();
      try {
        const result = await getDb().batchDeleteApplications(ids, auth.userId);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch {
        return {
          content: [{ type: "text", text: "Batch delete failed" }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "list_applications_filtered",
    "List applications with filters, sorting, and field selection. Use 'fields' to exclude large fields like jobDescription and reduce token usage. Defaults to all fields, no contacts.",
    {
      status: z
        .array(z.enum(["inbound", "applied", "interview", "offer", "rejected"]))
        .optional()
        .describe("Filter by status(es)"),
      rating_gte: z.number().min(1).max(5).optional().describe("Minimum rating (inclusive)"),
      search: z.string().optional().describe("Search in company, role, notes, jobDescription"),
      remote: z.boolean().optional().describe("Filter by remote flag"),
      sort: z
        .string()
        .optional()
        .describe("Sort field, prefix with - for descending. e.g. '-rating', 'company', '-salaryMax'"),
      fields: z
        .array(z.string())
        .optional()
        .describe(
          "Fields to include in response (id is always included). " +
          "e.g. ['company','role','status','rating','notes','salaryMin','salaryMax']. " +
          "Omit jobDescription to save ~30k tokens."
        ),
      limit: z.number().min(1).max(200).optional().describe("Max results to return"),
      include_contacts: z.boolean().optional().describe("Include nested contacts? (default: false)"),
    },
    async (args) => {
      try {
        const apps = await getDb().listApplicationsFiltered(auth.readScopeUserId, {
          status: args.status,
          ratingGte: args.rating_gte,
          search: args.search,
          remote: args.remote,
          sort: args.sort,
          fields: args.fields,
          limit: args.limit,
          includeContacts: args.include_contacts,
        });
        return {
          content: [{ type: "text", text: JSON.stringify(apps, null, 2) }],
        };
      } catch {
        return {
          content: [{ type: "text", text: "Failed to list applications" }],
          isError: true,
        };
      }
    }
  );

  // ── Contacts ────────────────────────────────────────────────────────────

  server.tool(
    "create_contact",
    "Add a contact to an application",
    {
      applicationId: z.string().describe("Application ID"),
      name: z.string().describe("Contact name"),
      email: z.string().optional().describe("Contact email"),
      phone: z.string().optional().describe("Phone number"),
      role: z.string().optional().describe("Contact's role (e.g. Recruiter)"),
      linkedIn: z.string().optional().describe("LinkedIn profile URL"),
    },
    async ({ applicationId, ...data }) => {
      const owns = await getDb().verifyApplicationOwner(applicationId, auth.userId);
      if (!owns) {
        return {
          content: [{ type: "text", text: "Application not found or access denied" }],
          isError: true,
        };
      }
      const contact = await getDb().createContact(applicationId, auth.userId, {
        name: data.name.slice(0, 255),
        email: data.email?.slice(0, 255) ?? null,
        phone: data.phone?.slice(0, 50) ?? null,
        role: data.role?.slice(0, 100) ?? null,
        linkedIn: data.linkedIn?.slice(0, 500) ?? null,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(contact, null, 2) }],
      };
    }
  );

  server.tool(
    "update_contact",
    "Update a contact on an application",
    {
      contactId: z.string().describe("Contact ID"),
      applicationId: z.string().describe("Application ID"),
      name: z.string().optional().describe("Contact name"),
      email: z.string().nullable().optional().describe("Contact email"),
      phone: z.string().nullable().optional().describe("Phone number"),
      role: z.string().nullable().optional().describe("Contact's role"),
      linkedIn: z.string().nullable().optional().describe("LinkedIn URL"),
    },
    async ({ contactId, applicationId, ...data }) => {
      try {
        const contact = await getDb().updateContact(
          contactId,
          applicationId,
          auth.userId,
          {
            name: data.name?.slice(0, 255),
            email: data.email !== undefined ? (data.email?.slice(0, 255) ?? null) : undefined,
            phone: data.phone !== undefined ? (data.phone?.slice(0, 50) ?? null) : undefined,
            role: data.role !== undefined ? (data.role?.slice(0, 100) ?? null) : undefined,
            linkedIn:
              data.linkedIn !== undefined
                ? (data.linkedIn?.slice(0, 500) ?? null)
                : undefined,
          }
        );
        return {
          content: [{ type: "text", text: JSON.stringify(contact, null, 2) }],
        };
      } catch {
        return {
          content: [{ type: "text", text: "Contact not found or access denied" }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "delete_contact",
    "Delete a contact from an application",
    {
      contactId: z.string().describe("Contact ID"),
      applicationId: z.string().describe("Application ID"),
    },
    async ({ contactId, applicationId }) => {
      try {
        await getDb().deleteContact(contactId, applicationId, auth.userId);
        return { content: [{ type: "text", text: "Contact deleted" }] };
      } catch {
        return {
          content: [{ type: "text", text: "Contact not found or access denied" }],
          isError: true,
        };
      }
    }
  );

  // ── Documents ───────────────────────────────────────────────────────────

  server.tool(
    "list_documents",
    "List uploaded documents with optional application, lifecycle, submission, orphan, pagination, and field-selection filters.",
    {
      applicationId: z.string().optional(),
      documentType: z.string().max(100).optional(),
      state: z.enum(["draft", "current", "submitted", "superseded", "historical", "orphaned"]).optional(),
      submissionId: z.string().optional(),
      orphaned: z.boolean().optional(),
      fields: z.array(z.string()).max(30).optional(),
      page: z.number().int().min(1).optional(),
      pageSize: z.number().int().min(1).max(200).optional(),
    },
    async (args) => {
      const docs = await getDb().listDocumentsFiltered(auth.readScopeUserId, {
        ...args,
        excludeSubmissionArtifacts: !canAccessSubmissions,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(docs, null, 2) }],
      };
    },
  );

  server.tool(
    "get_document",
    "Get a single document by ID",
    { id: z.string().describe("Document ID") },
    async ({ id }) => {
      const doc = await getDb().getDocument(id, auth.readScopeUserId);
      if (!doc) {
        return {
          content: [{ type: "text", text: "Document not found" }],
          isError: true,
        };
      }
      if (!canAccessSubmissions && isSubmissionDocument(doc)) return submissionScopeError();
      return {
        content: [{ type: "text", text: JSON.stringify(doc, null, 2) }],
      };
    }
  );

  server.tool(
    "upload_document_content",
    "Upload a document from base64 content. Supports PDF, JPEG, PNG, and WEBP files up to 10MB. Optionally links the uploaded document to applications owned by the authenticated user.",
    {
      filename: z.string().min(1).max(255).describe("Original filename to display, e.g. resume.pdf"),
      mimeType: z
        .enum(["application/pdf", "image/jpeg", "image/png", "image/webp"])
        .describe("MIME type of the uploaded file"),
      contentBase64: z.string().min(1).max(MAX_DOCUMENT_BASE64_SIZE).describe("Raw file bytes encoded as standard base64"),
      applicationIds: z.array(z.string()).optional().describe("Application IDs to link"),
    },
    async (args) => uploadDocumentContent(args, auth.userId),
  );

  server.tool(
    "download_document_content",
    "Download the binary content of a document. For files <=1MB the content is returned inline as base64. For larger files, a short-lived signed URL is returned instead when object storage is available (falls back to inline base64 otherwise).",
    { id: z.string().describe("Document ID") },
    async ({ id }) => {
      const document = await getDb().getDocument(id, auth.readScopeUserId);
      if (!document) {
        return { content: [{ type: "text", text: "Document not found" }], isError: true };
      }
      if (!canAccessSubmissions && isSubmissionDocument(document)) return submissionScopeError();
      return downloadDocumentContent(id, auth.readScopeUserId);
    },
  );

  server.tool(
    "update_document_links",
    "Update which applications a document is linked to",
    {
      id: z.string().describe("Document ID"),
      applicationIds: z.array(z.string()).describe("Application IDs to link"),
    },
    async ({ id, applicationIds }) => {
      try {
        const existing = await getDb().getDocument(id, auth.userId);
        if (!existing) throw new Error("not_found");
        if (!canAccessSubmissions && requiresSubmissionScopeForDocumentMutation(existing)) {
          return submissionScopeError();
        }
        const doc = await getDb().updateDocumentLinks(id, auth.userId, applicationIds);
        if (!canAccessSubmissions && isSubmissionDocument(doc)) return submissionScopeError();
        return {
          content: [{ type: "text", text: JSON.stringify(doc, null, 2) }],
        };
      } catch {
        return {
          content: [{ type: "text", text: "Document not found or access denied" }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "update_document_metadata",
    "Classify an owned document and update lifecycle metadata. Submitted document content remains immutable.",
    {
      id: z.string().describe("Document ID"),
      documentType: z.string().max(100).optional(),
      state: z.enum(["draft", "current", "submitted", "superseded", "historical", "orphaned"]).optional(),
      version: z.number().int().min(1).optional(),
      contentHash: z.string().regex(/^[a-f0-9]{64}$/i).nullable().optional(),
      source: z.string().max(100).nullable().optional(),
      generatedAt: z.string().datetime().nullable().optional(),
      submittedAt: z.string().datetime().nullable().optional(),
    },
    async ({ id, generatedAt, submittedAt, ...metadata }) => {
      try {
        const existing = await getDb().getDocument(id, auth.userId);
        if (!existing) throw new Error("not_found");
        if (
          !canAccessSubmissions
          && (
            requiresSubmissionScopeForDocumentMutation(existing, metadata.state)
          )
        ) return submissionScopeError();
        const document = await getDb().updateDocumentMetadata(id, auth.userId, {
          ...metadata,
          ...(generatedAt !== undefined && {
            generatedAt: generatedAt ? new Date(generatedAt) : null,
          }),
          ...(submittedAt !== undefined && {
            submittedAt: submittedAt ? new Date(submittedAt) : null,
          }),
        });
        if (!canAccessSubmissions && isSubmissionDocument(document)) return submissionScopeError();
        return { content: [{ type: "text", text: JSON.stringify(document, null, 2) }] };
      } catch {
        return {
          content: [{ type: "text", text: "Document not found or access denied" }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "delete_document",
    "Delete a document",
    { id: z.string().describe("Document ID") },
    async ({ id }) => {
      try {
        const result = await deleteDocumentWithContent(getDb(), id, auth.userId);
        if (!result) {
          return {
            content: [{ type: "text", text: "Document not found or access denied" }],
            isError: true,
          };
        }
        return { content: [{ type: "text", text: "Document deleted" }] };
      } catch {
        return {
          content: [{ type: "text", text: "Document not found or access denied" }],
          isError: true,
        };
      }
    }
  );

  // ── CV ─────────────────────────────────────────────────────────────────

  server.tool(
    "get_cv_profile",
    "Get the master CV profile for the authenticated user. Returns all experience entries, skill categories, projects, and education — use these IDs/names when calling generate_tailored_cv.",
    {},
    async () => {
      const profile = await getDb().getCvProfile(auth.userId);
      if (!profile) {
        return {
          content: [{ type: "text", text: "No CV profile found. Use upsert_cv_profile to create one." }],
        };
      }
      return {
        content: [{ type: "text", text: JSON.stringify(profile, null, 2) }],
      };
    }
  );

  server.tool(
    "upsert_cv_profile",
    "Create or update the master CV profile. This stores your base CV data that tailored CVs are generated from.",
    {
      name: z.string().describe("Full name"),
      contact: z.object({
        email: z.string().optional(),
        phone: z.string().optional(),
        linkedin: z.string().optional(),
        github: z.string().optional(),
        location: z.string().optional(),
      }).describe("Contact information"),
      profile: z.string().describe("Professional summary"),
      skills: z.array(z.object({
        category: z.string().describe("Skill category name"),
        items: z.array(z.string()).describe("Skills in this category"),
      })).describe("Skill categories"),
      experience: z.array(z.object({
        id: z.string().describe("Unique identifier for this entry (e.g. company-date slug)"),
        company: z.string(),
        title: z.string(),
        date: z.string().describe("Date range, e.g. 'Jan 2023 -- Present'"),
        location: z.string(),
        tier: z.number().min(1).max(3).describe("1=detailed with bullets, 2=bullets, 3=compact no bullets"),
        bullets: z.array(z.string()).describe("Achievement bullets"),
      })).describe("Work experience entries"),
      projects: z.array(z.object({
        name: z.string(),
        url: z.string().optional(),
        stack: z.string(),
        description: z.string(),
      })).optional().describe("Side projects"),
      education: z.array(z.object({
        institution: z.string(),
        degree: z.string(),
        date: z.string(),
        location: z.string(),
        details: z.string().optional(),
      })).optional().describe("Education entries"),
    },
    async (data) => {
      try {
        const input: UpsertCvProfileInput = {
          name: data.name,
          contact: data.contact,
          profile: data.profile,
          skills: data.skills,
          experience: data.experience,
          projects: data.projects,
          education: data.education,
        };
        const profile = await getDb().upsertCvProfile(auth.userId, input);
        return {
          content: [{ type: "text", text: JSON.stringify(profile, null, 2) }],
        };
      } catch {
        return {
          content: [{ type: "text", text: "Failed to upsert CV profile" }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "generate_tailored_cv",
    "Generate a tailored CV PDF for a specific application. Selects experience entries and skill categories from the master CV profile, renders a PDF, and stores it as a document linked to the application. Requires a CV profile to exist first (use upsert_cv_profile).",
    {
      applicationId: z.string().describe("Application ID to generate CV for"),
      profileOverride: z.string().optional().describe("Custom professional summary for this application (omit to use master)"),
      experienceIds: z.array(z.string()).describe("Ordered list of experience entry IDs to include"),
      skillCategories: z.array(z.string()).describe("Ordered list of skill category names to include"),
      includeProjects: z.boolean().optional().default(false).describe("Include projects section?"),
      includeEducation: z.boolean().optional().default(true).describe("Include education section?"),
    },
    async (args) => {
      try {
        const db = getDb();

        // Verify application ownership
        const app = await db.getApplication(args.applicationId, auth.readScopeUserId);
        if (!app) {
          return {
            content: [{ type: "text", text: "Application not found or access denied" }],
            isError: true,
          };
        }

        // Get CV profile
        const profile = await db.getCvProfile(auth.userId);
        if (!profile) {
          return {
            content: [{ type: "text", text: "No CV profile found. Use upsert_cv_profile first." }],
            isError: true,
          };
        }

        // Upsert the patch
        const patch = await db.upsertCvPatch(args.applicationId, {
          profileOverride: args.profileOverride,
          experienceIds: args.experienceIds,
          skillCategories: args.skillCategories,
          includeProjects: args.includeProjects,
          includeEducation: args.includeEducation,
        });

        const { doc, warnings } = await generateAndStoreCv({
          db,
          userId: auth.userId,
          applicationId: args.applicationId,
          company: app.company,
          role: app.role,
          profile,
          patch,
        });

        const result: Record<string, unknown> = {
          message: "CV generated successfully",
          documentId: doc.id,
          originalName: doc.originalName,
          size: doc.size,
          applicationId: args.applicationId,
          company: app.company,
          role: app.role,
        };
        if (warnings.length > 0) {
          result.warnings = warnings;
        }

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Failed to generate CV: ${err instanceof Error ? err.message : "unknown error"}` }],
          isError: true,
        };
      }
    }
  );

  return server;
}

// ── Request handler ─────────────────────────────────────────────────────────

async function handleMcpRequest(req: NextRequest): Promise<Response> {
  // Authenticate
  const auth = await authenticateFromRequest(req);
  if (!auth) {
    // RFC 9728 §5.1: include WWW-Authenticate with resource_metadata so MCP
    // clients (ChatGPT, Cursor, etc.) can discover the OAuth flow. Without
    // this, some clients refuse to attempt authorization.
    const baseUrl = process.env.BETTER_AUTH_URL?.replace(/\/+$/, "")
      ?? `${req.nextUrl.protocol}//${req.nextUrl.host}`;
    return new Response(JSON.stringify({ error: "Unauthorized – provide Bearer token" }), {
      status: 401,
      headers: {
        "Content-Type": "application/json",
        "WWW-Authenticate": `Bearer realm="${baseUrl}/api/mcp", resource_metadata="${baseUrl}/.well-known/oauth-protected-resource"`,
      },
    });
  }

  // Create a stateless transport + server per request
  const server = createMcpServer(auth);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
    enableJsonResponse: true,
  });

  try {
    await server.connect(transport);
    return await transport.handleRequest(req as unknown as Request);
  } finally {
    await transport.close().catch(() => {});
    await server.close().catch(() => {});
  }
}

export async function GET(req: NextRequest) {
  return handleMcpRequest(req);
}

export async function POST(req: NextRequest) {
  return handleMcpRequest(req);
}

export async function DELETE(req: NextRequest) {
  return handleMcpRequest(req);
}
