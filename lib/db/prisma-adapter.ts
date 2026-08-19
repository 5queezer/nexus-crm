import { prisma } from "@/lib/prisma";
import { Prisma, type ApplicationSubmission, type ApplicationEvent, type Document as PrismaDocument } from "@prisma/client";
import { normalizeStatus } from "@/types";
import { sanitizeTriageFields } from "./sanitize";
import { resolveAppliedAtForCreate } from "@/lib/applications/defaults";
import {
  submissionInputRequestHash,
  submissionReplayRequestHashes,
  submissionRequestHash,
  validateSubmissionConflicts,
  validateSubmissionDocumentIds,
  validateSubmissionPolicy,
} from "@/lib/applications/submission";
import {
  deriveEventProjection,
  encodeEventCursor,
  validateApplicationSummary,
} from "@/lib/applications/events";
import type { DatabaseAdapter } from "./adapter";
import type {
  ApplicationRecord,
  ContactRecord,
  DocumentRecord,
  UserRecord,
  AuditLogRecord,
  ApiTokenRecord,
  ApiTokenInfo,
  ShareLinkRecord,
  CreateApplicationInput,
  UpdateApplicationInput,
  CreateContactInput,
  UpdateContactInput,
  CreateDocumentInput,
  CreateShareLinkInput,
  ListApplicationsFilter,
  PaginationParams,
  PaginatedResult,
  BatchUpsertItem,
  BatchUpsertResult,
  BatchDeleteResult,
  CvProfileRecord,
  UpsertCvProfileInput,
  CvPatchRecord,
  UpsertCvPatchInput,
  ApplicationSubmissionRecord,
  ApplicationEventRecord,
  RecordSubmissionInput,
  RecordSubmissionResult,
  CreateApplicationEventInput,
  RecordApplicationEventInput,
  RecordApplicationEventResult,
  ListApplicationEventsFilter,
  ApplicationEventPage,
  ListDocumentsFilter,
  UpdateDocumentMetadataInput,
  DocumentMutationOptions,
  DemoReadOptions,
  EnsureDemoWorkspaceResult,
  DeleteDemoWorkspaceResult,
  CareerOpsThreadRecord,
  CareerOpsRunRecord,
  CareerOpsRunStatus,
  CreateCareerOpsThreadInput,
  CreateCareerOpsRunInput,
  CreateCareerOpsRunResult,
} from "./types";
import type { DemoFixtures } from "@/lib/demo-workspace/fixtures";

// ── Helpers: convert Prisma int IDs ↔ string IDs ────────────────────────────

function sid(n: number): string {
  return String(n);
}

function nid(id: string): number {
  if (!/^[1-9]\d*$/.test(id)) throw new Error(`Invalid numeric id: ${id}`);
  const parsed = Number(id);
  if (!Number.isSafeInteger(parsed) || parsed > 2_147_483_647) {
    throw new Error(`Invalid numeric id: ${id}`);
  }
  return parsed;
}

// Use Prisma's generated payload type instead of a long inline type
type AppRow = Prisma.ApplicationGetPayload<{ include: { contacts: true } }>;

function mapContact(c: AppRow["contacts"][number]): ContactRecord {
  return { ...c, id: sid(c.id), applicationId: sid(c.applicationId) };
}

function mapApp(a: AppRow): ApplicationRecord {
  return {
    ...a,
    id: sid(a.id),
    demoWorkspaceId: a.demoWorkspaceId === null ? null : sid(a.demoWorkspaceId),
    status: normalizeStatus(a.status),
    eligibleCountries: Array.isArray(a.eligibleCountries) ? (a.eligibleCountries as string[]) : [],
    primaryLocations: Array.isArray(a.primaryLocations) ? (a.primaryLocations as string[]) : [],
    contacts: a.contacts?.map(mapContact),
  };
}

type DocumentWithApplications = PrismaDocument & {
  applications?: { id: number; company: string; role: string }[];
};

function mapDoc(d: DocumentWithApplications): DocumentRecord {
  return {
    ...d,
    id: sid(d.id),
    submissionId: d.submissionId ? sid(d.submissionId) : null,
    applicationIds: d.applications?.map((application) => sid(application.id)),
    applications: d.applications?.map((a) => ({ id: sid(a.id), company: a.company, role: a.role })),
  };
}

function mapSubmission(
  row: ApplicationSubmission & { documents?: DocumentWithApplications[] },
  includeAnswers = true,
): ApplicationSubmissionRecord {
  return {
    ...row,
    id: sid(row.id),
    applicationId: sid(row.applicationId),
    answers: includeAnswers
      ? (row.answers as unknown as ApplicationSubmissionRecord["answers"])
      : [],
    policy: row.policy as unknown as ApplicationSubmissionRecord["policy"],
    documentIds: row.documentIds as unknown as string[],
    documents: row.documents?.map(mapDoc),
  };
}

type EventWithApplication = ApplicationEvent & {
  application?: { id: number; company: string; role: string };
};

function publicEventMetadata(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const metadata = { ...(value as Record<string, unknown>) };
  delete metadata.requestHash;
  return metadata;
}

function mapEvent(row: EventWithApplication): ApplicationEventRecord {
  return {
    id: sid(row.id),
    isDemo: row.isDemo,
    demoWorkspaceId: row.demoWorkspaceId === null ? null : sid(row.demoWorkspaceId),
    demoKey: row.demoKey,
    userId: row.userId,
    applicationId: sid(row.applicationId),
    type: row.type,
    idempotencyKey: row.idempotencyKey,
    occurredAt: row.occurredAt,
    source: row.source,
    actor: row.actor,
    contactId: row.contactId ?? null,
    outcome: row.outcome ?? null,
    metadata: publicEventMetadata(row.metadata),
    createdAt: row.createdAt,
    application: row.application
      ? { id: sid(row.application.id), company: row.application.company, role: row.application.role }
      : undefined,
  };
}

function submissionEventKey(idempotencyKey: string): string {
  return `submission:${idempotencyKey}`;
}

function eventDemoData(
  application: { isDemo: boolean; demoWorkspaceId: number | null; demoKey: string | null },
  stableKey: string,
): { isDemo: boolean; demoWorkspaceId: number | null; demoKey: string | null } {
  const complete = application.isDemo && application.demoWorkspaceId !== null && application.demoKey !== null;
  const empty = !application.isDemo && application.demoWorkspaceId === null && application.demoKey === null;
  if (!complete && !empty) throw new Error("demo_marker_conflict");
  return complete
    ? {
        isDemo: true,
        demoWorkspaceId: application.demoWorkspaceId,
        demoKey: `${application.demoKey}:event:${stableKey}`,
      }
    : { isDemo: false, demoWorkspaceId: null, demoKey: null };
}

function assertEventMatchesParent(
  event: { isDemo: boolean; demoWorkspaceId: number | null; demoKey: string | null },
  application: { isDemo: boolean; demoWorkspaceId: number | null; demoKey: string | null },
): void {
  const expected = eventDemoData(application, "replay");
  if (
    (event.isDemo ?? false) !== expected.isDemo
    || (event.demoWorkspaceId ?? null) !== expected.demoWorkspaceId
    || (expected.isDemo && (typeof event.demoKey !== "string" || event.demoKey.length === 0))
    || (!expected.isDemo && event.demoKey != null)
  ) throw new Error("demo_marker_conflict");
}

async function loadSubmissionReplay(
  userId: string,
  idempotencyKey: string,
  acceptedRequestHashes: ReadonlySet<string>,
): Promise<RecordSubmissionResult | null> {
  const submission = await prisma.applicationSubmission.findUnique({
    where: { userId_idempotencyKey: { userId, idempotencyKey } },
    include: {
      documents: {
        include: { applications: { select: { id: true, company: true, role: true } } },
      },
    },
  });
  if (!submission) return null;
  if (!acceptedRequestHashes.has(submission.requestHash)) throw new Error("idempotency_conflict");
  const [application, event] = await Promise.all([
    prisma.application.findFirst({
      where: { id: submission.applicationId, userId },
      include: { contacts: true },
    }),
    prisma.applicationEvent.findUnique({
      where: {
        userId_idempotencyKey: {
          userId,
          idempotencyKey: submissionEventKey(idempotencyKey),
        },
      },
    }),
  ]);
  if (!application) throw new Error("not_found");
  if (event) assertEventMatchesParent(event, application);
  const mappedSubmission = mapSubmission(submission);
  return {
    replayed: true,
    dryRun: false,
    verified:
      application.status === "applied" && submission.documents.length === mappedSubmission.documentIds.length,
    application: mapApp(application),
    submission: mappedSubmission,
    event: event ? mapEvent(event) : null,
    documents: submission.documents.map(mapDoc),
  };
}

type CvProfileRow = Prisma.CvProfileGetPayload<object>;

function mapCvProfile(row: CvProfileRow): CvProfileRecord {
  return {
    id: sid(row.id),
    userId: row.userId,
    name: row.name,
    contact: row.contact as unknown as CvProfileRecord["contact"],
    profile: row.profile,
    skills: row.skills as unknown as CvProfileRecord["skills"],
    experience: row.experience as unknown as CvProfileRecord["experience"],
    projects: row.projects as unknown as CvProfileRecord["projects"],
    education: row.education as unknown as CvProfileRecord["education"],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function userWhere(userId: string | null): { userId: string } | object {
  return userId !== null ? { userId } : {};
}

function demoWhere(options?: DemoReadOptions): { isDemo?: boolean } {
  if (options?.demoVisibility === "exclude") return { isDemo: false };
  if (options?.demoVisibility === "only") return { isDemo: true };
  return {};
}

function pickFields(apps: ApplicationRecord[], fields?: string[]): Partial<ApplicationRecord>[] {
  if (!fields?.length) return apps;
  return apps.map((app) => {
    const picked: Partial<ApplicationRecord> = {};
    for (const f of fields) {
      if (f in app) {
        const key = f as keyof ApplicationRecord;
        (picked as Record<string, unknown>)[f] = app[key];
      }
    }
    picked.id = app.id;
    return picked;
  });
}

function pickDocumentFields(
  documents: DocumentRecord[],
  fields?: string[],
): Partial<DocumentRecord>[] {
  if (!fields?.length) return documents;
  return documents.map((document) => {
    const picked: Partial<DocumentRecord> = { id: document.id };
    for (const field of fields) {
      if (field in document) {
        (picked as Record<string, unknown>)[field] =
          document[field as keyof DocumentRecord];
      }
    }
    return picked;
  });
}

const STRUCTURED_APPLICATION_FIELDS = [
  "canonicalJobUrl", "workMode", "eligibleCountries", "primaryLocations",
  "officeDaysMin", "travelPercent", "visaSponsorship", "rightToWorkRequired",
  "timezoneOverlap", "salaryCurrency", "salaryPeriod", "salaryType", "atsName",
  "requisitionId", "jobCapturedAt", "jobVerifiedAt", "jobPostedAt", "jobClosedAt",
  "jobContentHash", "jobLiveness", "jobSummary", "currentStage",
] as const;

function structuredApplicationData(data: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const field of STRUCTURED_APPLICATION_FIELDS) {
    if (data[field] !== undefined) result[field] = data[field];
  }
  return result;
}

// ── Implementation ──────────────────────────────────────────────────────────

export class PrismaAdapter implements DatabaseAdapter {
  async ensureDemoWorkspace(
    userId: string,
    fixtures: DemoFixtures,
  ): Promise<EnsureDemoWorkspaceResult> {
    return prisma.$transaction(async (tx) => {
      const owner = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE
      `;
      if (!owner.length) throw new Error("user_not_found");

      const existing = await tx.demoWorkspace.findUnique({ where: { userId } });
      if (existing) {
        if (existing.seedVersion !== fixtures.seedVersion) throw new Error("demo_version_conflict");
        if (existing.state !== "ready") throw new Error("demo_workspace_unavailable");
        const applications = await tx.application.findMany({
          where: { userId, demoWorkspaceId: existing.id, isDemo: true },
          include: { contacts: true },
          orderBy: { demoKey: "asc" },
        });
        const events = await tx.applicationEvent.findMany({
          where: { userId, demoWorkspaceId: existing.id, isDemo: true },
          select: { demoKey: true },
        });
        const actualApplicationKeys = applications.map((row) => row.demoKey).sort();
        const expectedApplicationKeys = fixtures.applications.map((fixture) => fixture.demoKey).sort();
        const actualEventKeys = events.map((row) => row.demoKey).sort();
        const expectedEventKeys = fixtures.events.map((fixture) => fixture.demoKey).sort();
        if (
          JSON.stringify(actualApplicationKeys) !== JSON.stringify(expectedApplicationKeys)
          || !expectedEventKeys.every((key) => actualEventKeys.includes(key))
        ) throw new Error("demo_workspace_incomplete");
        return {
          workspace: { ...existing, id: sid(existing.id), state: existing.state as "creating" | "ready" | "deleting" },
          applications: applications.map(mapApp),
          replayed: true,
        };
      }

      const realCount = await tx.application.count({ where: { userId, isDemo: false } });
      if (realCount > 0) throw new Error("real_applications_exist");

      const workspace = await tx.demoWorkspace.create({
        data: { userId, seedVersion: fixtures.seedVersion, state: "creating", createdAt: fixtures.createdAt },
      });
      const applicationsByKey = new Map<string, number>();
      for (const fixture of fixtures.applications) {
        const row = await tx.application.create({
          data: {
            userId,
            company: fixture.company,
            role: fixture.role,
            status: fixture.status,
            appliedAt: fixture.appliedAt,
            lastContact: fixture.lastContact,
            followUpAt: fixture.followUpAt,
            notes: fixture.notes,
            jobDescription: null,
            source: fixture.source,
            remote: fixture.remote,
            salaryMin: fixture.salaryMin,
            salaryMax: fixture.salaryMax,
            rating: fixture.rating,
            jobUrl: null,
            isDemo: true,
            demoWorkspaceId: workspace.id,
            demoKey: fixture.demoKey,
            createdAt: fixtures.createdAt,
          },
        });
        applicationsByKey.set(fixture.demoKey, row.id);
      }
      for (const fixture of fixtures.events) {
        const applicationId = applicationsByKey.get(fixture.applicationDemoKey);
        if (!applicationId) throw new Error("demo_fixture_invalid");
        await tx.applicationEvent.create({
          data: {
            userId,
            applicationId,
            type: fixture.type,
            occurredAt: fixture.occurredAt,
            source: fixture.source,
            actor: fixture.actor,
            metadata: fixture.metadata as Prisma.InputJsonValue,
            isDemo: true,
            demoWorkspaceId: workspace.id,
            demoKey: fixture.demoKey,
          },
        });
      }
      const ready = await tx.demoWorkspace.update({
        where: { id: workspace.id },
        data: { state: "ready" },
      });
      const applications = await tx.application.findMany({
        where: { userId, demoWorkspaceId: workspace.id, isDemo: true },
        include: { contacts: true },
        orderBy: { demoKey: "asc" },
      });
      return {
        workspace: { ...ready, id: sid(ready.id), state: "ready" as const },
        applications: applications.map(mapApp),
        replayed: false,
      };
    });
  }

  async deleteDemoWorkspace(userId: string): Promise<DeleteDemoWorkspaceResult> {
    return prisma.$transaction(async (tx) => {
      const owner = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE
      `;
      if (!owner.length) throw new Error("user_not_found");
      const workspace = await tx.demoWorkspace.findUnique({ where: { userId } });
      if (!workspace) return { deletedApplications: 0, deletedEvents: 0 };
      const [deletedApplications, deletedEvents] = await Promise.all([
        tx.application.count({ where: { userId, demoWorkspaceId: workspace.id, isDemo: true } }),
        tx.applicationEvent.count({ where: { userId, demoWorkspaceId: workspace.id, isDemo: true } }),
      ]);
      // Preserve the Firestore cleanup contract before the workspace cascade deletes
      // submissions and the database clears Document.submissionId via SetNull.
      await tx.document.updateMany({
        where: {
          userId,
          applications: {
            some: { userId, demoWorkspaceId: workspace.id, isDemo: true },
          },
        },
        data: { demoProvenance: true },
      });
      await tx.document.updateMany({
        where: {
          userId,
          submission: {
            application: { userId, demoWorkspaceId: workspace.id, isDemo: true },
          },
        },
        data: { state: "historical", demoProvenance: true },
      });
      await tx.demoWorkspace.delete({ where: { id: workspace.id, userId } });
      return { deletedApplications, deletedEvents };
    });
  }

  // Applications

  async listApplications(userId: string | null, options?: DemoReadOptions): Promise<ApplicationRecord[]> {
    const rows = await prisma.application.findMany({
      where: { ...userWhere(userId), ...demoWhere(options) },
      orderBy: { createdAt: "desc" },
      include: { contacts: true },
    });
    return rows.map(mapApp);
  }

  async listApplicationsPaginated(
    userId: string | null,
    params: PaginationParams,
    options?: DemoReadOptions,
  ): Promise<PaginatedResult<ApplicationRecord>> {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.max(1, Math.min(100, params.pageSize ?? 10));
    const where = { ...userWhere(userId), ...demoWhere(options) };

    const [total, rows] = await Promise.all([
      prisma.application.count({ where }),
      prisma.application.findMany({
        where,
        orderBy: { createdAt: "desc" },
        include: { contacts: true },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      data: rows.map(mapApp),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async getApplication(
    id: string,
    userId: string | null,
    options?: DemoReadOptions,
  ): Promise<ApplicationRecord | null> {
    let numericId: number;
    try {
      numericId = nid(id);
    } catch {
      return null;
    }
    const row = await prisma.application.findFirst({
      where: { id: numericId, ...userWhere(userId), ...demoWhere(options) },
      include: { contacts: true },
    });
    return row ? mapApp(row) : null;
  }

  async createApplication(userId: string, data: CreateApplicationInput): Promise<ApplicationRecord> {
    validateApplicationSummary(data.notes);
    try {
      const row = await prisma.$transaction(async (tx) => {
        const owner = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE
        `;
        if (!owner.length) throw new Error("user_not_found");
        if (await tx.demoWorkspace.count({ where: { userId } })) throw new Error("demo_workspace_exists");
        return tx.application.create({
          data: {
            userId,
            ...data,
            status: normalizeStatus(data.status),
            appliedAt: resolveAppliedAtForCreate(data.status, data.appliedAt),
          },
          include: { contacts: true },
        });
      });
      return mapApp(row);
    } catch (error) {
      if (
        data.canonicalJobUrl &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new Error("canonical_job_url_conflict");
      }
      throw error;
    }
  }

  async updateApplication(id: string, userId: string, data: UpdateApplicationInput): Promise<ApplicationRecord> {
    const applicationId = nid(id);
    const mutableData = { ...data };
    if (data.notes !== undefined) {
      const current = await prisma.application.findFirst({
        where: { id: applicationId, userId },
        select: { notes: true },
      });
      if (!current) throw new Error("not_found");
      if (current.notes === data.notes) delete mutableData.notes;
      else validateApplicationSummary(data.notes);
    }
    const { expectedUpdatedAt, ...update } = mutableData;
    try {
      if (expectedUpdatedAt) {
        const result = await prisma.application.updateMany({
          where: { id: applicationId, userId, updatedAt: expectedUpdatedAt },
          data: {
            ...update,
            ...(update.status !== undefined ? { status: normalizeStatus(update.status) } : {}),
            eventVersion: { increment: 1 },
          },
        });
        if (result.count !== 1) {
          const current = await prisma.application.findFirst({
            where: { id: applicationId, userId },
            select: { id: true },
          });
          throw new Error(current ? "conflict" : "not_found");
        }
        const row = await prisma.application.findFirstOrThrow({
          where: { id: applicationId, userId },
          include: { contacts: true },
        });
        return mapApp(row);
      }

      const row = await prisma.application.update({
        where: { id: applicationId, userId },
        data: {
          ...update,
          ...(update.status !== undefined ? { status: normalizeStatus(update.status) } : {}),
          eventVersion: { increment: 1 },
        },
        include: { contacts: true },
      });
      return mapApp(row);
    } catch (error) {
      if (error instanceof Error && (error.message === "conflict" || error.message === "not_found")) {
        throw error;
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === "P2002") throw new Error("canonical_job_url_conflict");
        if (error.code === "P2025") throw new Error("not_found");
      }
      throw error;
    }
  }

  async deleteApplication(id: string, userId: string): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const applicationId = nid(id);
      const locked = await tx.$queryRaw<Array<{ id: number }>>`
        SELECT "id" FROM "Application"
        WHERE "id" = ${applicationId} AND "userId" = ${userId}
        FOR UPDATE
      `;
      if (!locked.length) throw new Error("not_found");
      const submissions = await tx.applicationSubmission.findMany({
        where: { applicationId, userId },
        select: { id: true },
      });
      if (submissions.length) {
        await tx.document.updateMany({
          where: {
            userId,
            submissionId: { in: submissions.map((submission) => submission.id) },
          },
          data: { state: "historical", submissionId: null },
        });
      }
      await tx.application.delete({ where: { id: applicationId, userId } });
    });
  }

  async findApplicationByCanonicalJobUrl(
    userId: string,
    canonicalJobUrl: string,
    options?: DemoReadOptions,
  ): Promise<ApplicationRecord | null> {
    const row = await prisma.application.findFirst({
      where: { userId, canonicalJobUrl, ...demoWhere(options) },
      include: { contacts: true },
    });
    return row ? mapApp(row) : null;
  }

  async appendApplicationNote(
    id: string,
    userId: string,
    note: string,
    eventInput: CreateApplicationEventInput,
  ): Promise<{ application: ApplicationRecord; event: ApplicationEventRecord }> {
    const requestHash = submissionRequestHash({ applicationId: id, note, type: eventInput.type });
    const loadReplay = async () => {
      if (!eventInput.idempotencyKey) return null;
      const event = await prisma.applicationEvent.findUnique({
        where: {
          userId_idempotencyKey: { userId, idempotencyKey: eventInput.idempotencyKey },
        },
      });
      if (!event) return null;
      const legacyHash = ((event.metadata ?? {}) as Record<string, unknown>).requestHash;
      if ((event.requestHash ?? legacyHash) !== requestHash) throw new Error("idempotency_conflict");
      const application = await prisma.application.findFirst({
        where: { id: nid(id), userId },
        include: { contacts: true },
      });
      if (!application) throw new Error("not_found");
      assertEventMatchesParent(event, application);
      return { application: mapApp(application), event: mapEvent(event) };
    };
    const existingReplay = await loadReplay();
    if (existingReplay) return existingReplay;

    try {
      return await prisma.$transaction(async (tx) => {
        const existing = await tx.application.findFirst({
          where: { id: nid(id), userId },
          include: { contacts: true },
        });
        if (!existing) throw new Error("not_found");
        if (eventInput.idempotencyKey) {
          const replay = await tx.applicationEvent.findUnique({
            where: {
              userId_idempotencyKey: {
                userId,
                idempotencyKey: eventInput.idempotencyKey,
              },
            },
          });
          if (replay) {
            const legacyHash = ((replay.metadata ?? {}) as Record<string, unknown>).requestHash;
            if ((replay.requestHash ?? legacyHash) !== requestHash) throw new Error("idempotency_conflict");
            assertEventMatchesParent(replay, existing);
            return { application: mapApp(existing), event: mapEvent(replay) };
          }
        }

        const expectedUpdatedAt = eventInput.expectedUpdatedAt;
        const changed = expectedUpdatedAt
          ? await tx.$executeRaw`
              UPDATE "Application"
              SET "notes" = CASE
                    WHEN "notes" IS NULL OR "notes" = '' THEN ${note}
                    ELSE "notes" || E'\n\n' || ${note}
                  END,
                  "updatedAt" = NOW(),
                  "eventVersion" = "eventVersion" + 1
              WHERE "id" = ${nid(id)}
                AND "userId" = ${userId}
                AND "updatedAt" = ${expectedUpdatedAt}
                AND char_length(
                  CASE
                    WHEN "notes" IS NULL OR "notes" = '' THEN ${note}
                    ELSE "notes" || E'\n\n' || ${note}
                  END
                ) <= 10000
            `
          : await tx.$executeRaw`
              UPDATE "Application"
              SET "notes" = CASE
                    WHEN "notes" IS NULL OR "notes" = '' THEN ${note}
                    ELSE "notes" || E'\n\n' || ${note}
                  END,
                  "updatedAt" = NOW(),
                  "eventVersion" = "eventVersion" + 1
              WHERE "id" = ${nid(id)}
                AND "userId" = ${userId}
                AND char_length(
                  CASE
                    WHEN "notes" IS NULL OR "notes" = '' THEN ${note}
                    ELSE "notes" || E'\n\n' || ${note}
                  END
                ) <= 10000
            `;
        if (changed !== 1) {
          const current = await tx.application.findFirst({ where: { id: nid(id), userId } });
          if (!current) throw new Error("not_found");
          if (expectedUpdatedAt && current.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
            throw new Error("conflict");
          }
          throw new Error("notes_too_long");
        }
        const application = await tx.application.findFirstOrThrow({
          where: { id: nid(id), userId },
          include: { contacts: true },
        });
        const event = await tx.applicationEvent.create({
          data: {
            userId,
            applicationId: nid(id),
            type: eventInput.type,
            idempotencyKey: eventInput.idempotencyKey ?? null,
            requestHash,
            occurredAt: eventInput.occurredAt,
            source: eventInput.source ?? null,
            actor: eventInput.actor ?? null,
            metadata: (eventInput.metadata ?? {}) as Prisma.InputJsonValue,
            ...eventDemoData(application, requestHash),
          },
        });
        return { application: mapApp(application), event: mapEvent(event) };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const replay = await loadReplay();
        if (replay) return replay;
      }
      throw error;
    }
  }

  async recordApplicationSubmission(
    userId: string,
    input: RecordSubmissionInput,
  ): Promise<RecordSubmissionResult> {
    const rawRequestHash = submissionInputRequestHash(input as unknown as Record<string, unknown>);
    let validatedPolicy: ReturnType<typeof validateSubmissionPolicy> | null = null;
    let policyError: unknown = null;
    try {
      validatedPolicy = validateSubmissionPolicy({
        policy: input.policy,
        answers: input.answers,
        documentIds: input.documentIds,
      });
    } catch (error) {
      policyError = error;
    }
    const requestHash = validatedPolicy
      ? submissionInputRequestHash({ ...input, policy: validatedPolicy } as unknown as Record<string, unknown>)
      : rawRequestHash;
    const acceptedReplayHashes = submissionReplayRequestHashes(
      input as unknown as Record<string, unknown>,
      validatedPolicy,
    );
    const initialReplay = await loadSubmissionReplay(userId, input.idempotencyKey, acceptedReplayHashes);
    if (initialReplay) return initialReplay;
    const policy = validatedPolicy;
    if (!policy) {
      throw policyError instanceof Error ? policyError : new Error("human_review_required");
    }
    const documentIds = validateSubmissionDocumentIds(input.documentIds);
    try {
      return await prisma.$transaction(async (tx) => {
      const applicationId = nid(input.applicationId);
      // Intentionally lock the owner's complete application set in a stable order.
      // Same-company and duplicate-requisition checks must serialize concurrent
      // submissions; narrowing this lock would reopen a TOCTOU race.
      const locked = await tx.$queryRaw<Array<{
        id: number;
        company: string;
        status: string;
        requisitionId: string | null;
        atsName: string | null;
      }>>`
        SELECT "id", "company", "status", "requisitionId", "atsName"
        FROM "Application"
        WHERE "userId" = ${userId}
        ORDER BY "id"
        FOR UPDATE
      `;
      const replay = await tx.applicationSubmission.findUnique({
        where: { userId_idempotencyKey: { userId, idempotencyKey: input.idempotencyKey } },
        include: {
          documents: {
            include: { applications: { select: { id: true, company: true, role: true } } },
          },
        },
      });
      if (replay) {
        if (!acceptedReplayHashes.has(replay.requestHash)) throw new Error("idempotency_conflict");
        const [application, event] = await Promise.all([
          tx.application.findFirstOrThrow({
            where: { id: replay.applicationId, userId },
            include: { contacts: true },
          }),
          tx.applicationEvent.findUnique({
            where: {
              userId_idempotencyKey: {
                userId,
                idempotencyKey: submissionEventKey(input.idempotencyKey),
              },
            },
          }),
        ]);
        if (event) assertEventMatchesParent(event, application);
        return {
          replayed: true,
          dryRun: false,
          verified: true,
          application: mapApp(application),
          submission: mapSubmission(replay),
          event: event ? mapEvent(event) : null,
          documents: replay.documents.map(mapDoc),
        };
      }
      if (!locked.some((row) => row.id === applicationId)) throw new Error("not_found");
      const application = await tx.application.findFirst({
        where: { id: applicationId, userId },
        include: { contacts: true },
      });
      if (!application) throw new Error("not_found");
      if (
        input.expectedUpdatedAt &&
        application.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()
      ) {
        throw new Error("conflict");
      }

      const effectiveAtsName = input.atsName !== undefined
        ? input.atsName
        : application.atsName;
      const effectiveRequisitionId = input.requisitionId !== undefined
        ? input.requisitionId
        : application.requisitionId;
      const existingSubmissionCount = await tx.applicationSubmission.count({
        where: { userId, applicationId },
      });
      validateSubmissionConflicts({
        applicationId: input.applicationId,
        company: application.company,
        requisitionId: effectiveRequisitionId,
        atsName: effectiveAtsName,
        existingSubmissionCount,
        policy,
        applications: locked.map((candidate) => ({
          ...candidate,
          id: sid(candidate.id),
          status: normalizeStatus(candidate.status),
        })),
      });

      const uniqueDocumentIds = documentIds;
      const documents = uniqueDocumentIds.length
        ? await tx.document.findMany({
            where: { id: { in: uniqueDocumentIds.map(nid) }, userId },
            include: { applications: { select: { id: true, company: true, role: true } } },
          })
        : [];
      if (documents.length !== uniqueDocumentIds.length) throw new Error("invalid_documents");
      if (documents.some((document) =>
        document.submissionId !== null
        || document.state === "submitted"
        || document.state === "historical"
      )) {
        throw new Error("document_already_submitted");
      }

      if (input.dryRun) {
        const predictedApplication = mapApp({
          ...application,
          status: "applied",
          appliedAt: input.submittedAt,
          followUpAt: input.followUpAt === undefined ? application.followUpAt : input.followUpAt,
          atsName: effectiveAtsName,
          requisitionId: effectiveRequisitionId,
        });
        const predictedDocuments = documents.map((document) =>
          mapDoc({
            ...document,
            state: "submitted",
            submittedAt: input.submittedAt,
          }),
        );
        return {
          replayed: false,
          dryRun: true,
          verified: true,
          application: predictedApplication,
          submission: {
            id: "dry-run",
            userId,
            applicationId: input.applicationId,
            idempotencyKey: input.idempotencyKey,
            requestHash,
            submittedAt: input.submittedAt,
            applicationUrl: input.applicationUrl ?? null,
            atsName: effectiveAtsName,
            requisitionId: effectiveRequisitionId,
            language: input.language ?? null,
            answers: input.answers,
            policy,
            candidateSalaryMin: input.candidateSalaryMin ?? null,
            candidateSalaryMax: input.candidateSalaryMax ?? null,
            candidateSalaryCurrency: input.candidateSalaryCurrency ?? null,
            candidateSalaryPeriod: input.candidateSalaryPeriod ?? null,
            candidateSalaryType: input.candidateSalaryType ?? null,
            candidateSalaryFlexible: input.candidateSalaryFlexible ?? false,
            documentIds: uniqueDocumentIds,
            createdAt: input.submittedAt,
            documents: predictedDocuments,
          },
          event: null,
          documents: predictedDocuments,
        };
      }

      const created = await tx.applicationSubmission.create({
        data: {
          userId,
          applicationId: nid(input.applicationId),
          idempotencyKey: input.idempotencyKey,
          requestHash,
          submittedAt: input.submittedAt,
          applicationUrl: input.applicationUrl ?? null,
          atsName: effectiveAtsName,
          requisitionId: effectiveRequisitionId,
          language: input.language ?? null,
          answers: input.answers as unknown as Prisma.InputJsonValue,
          policy: policy as unknown as Prisma.InputJsonValue,
          candidateSalaryMin: input.candidateSalaryMin ?? null,
          candidateSalaryMax: input.candidateSalaryMax ?? null,
          candidateSalaryCurrency: input.candidateSalaryCurrency ?? null,
          candidateSalaryPeriod: input.candidateSalaryPeriod ?? null,
          candidateSalaryType: input.candidateSalaryType ?? null,
          candidateSalaryFlexible: input.candidateSalaryFlexible ?? false,
          documentIds: uniqueDocumentIds as Prisma.InputJsonValue,
        },
      });

      if (uniqueDocumentIds.length) {
        const claimed = await tx.document.updateMany({
          where: {
            id: { in: uniqueDocumentIds.map(nid) },
            userId,
            submissionId: null,
            state: { notIn: ["submitted", "historical"] },
          },
          data: { state: "submitted", submittedAt: input.submittedAt, submissionId: created.id },
        });
        if (claimed.count !== uniqueDocumentIds.length) {
          throw new Error("document_already_submitted");
        }
      }

      const applicationUpdate = {
        status: "applied",
        appliedAt: input.submittedAt,
        eventVersion: { increment: 1 },
        ...(input.followUpAt !== undefined ? { followUpAt: input.followUpAt } : {}),
        ...(input.atsName !== undefined ? { atsName: input.atsName } : {}),
        ...(input.requisitionId !== undefined ? { requisitionId: input.requisitionId } : {}),
      };
      if (input.expectedUpdatedAt) {
        const updated = await tx.application.updateMany({
          where: {
            id: nid(input.applicationId),
            userId,
            updatedAt: input.expectedUpdatedAt,
          },
          data: applicationUpdate,
        });
        if (updated.count !== 1) throw new Error("conflict");
      } else {
        await tx.application.update({
          where: { id: nid(input.applicationId), userId },
          data: applicationUpdate,
        });
      }
      const updatedApplication = await tx.application.findFirstOrThrow({
        where: { id: nid(input.applicationId), userId },
        include: { contacts: true },
      });
      const event = await tx.applicationEvent.create({
        data: {
          userId,
          applicationId: nid(input.applicationId),
          type: "application_submitted",
          idempotencyKey: submissionEventKey(input.idempotencyKey),
          occurredAt: input.submittedAt,
          source: input.source ?? "mcp",
          actor: input.actor ?? null,
          metadata: {
            submissionId: sid(created.id),
            documentIds: uniqueDocumentIds,
            answerCount: input.answers.length,
            policy,
          } as unknown as Prisma.InputJsonValue,
          ...eventDemoData(updatedApplication, requestHash),
        },
      });
      const stored = await tx.applicationSubmission.findUniqueOrThrow({
        where: { id: created.id },
        include: {
          documents: {
            include: { applications: { select: { id: true, company: true, role: true } } },
          },
        },
      });
      return {
        replayed: false,
        dryRun: false,
        verified:
          updatedApplication.status === "applied" &&
          updatedApplication.appliedAt?.getTime() === input.submittedAt.getTime() &&
          stored.documents.length === uniqueDocumentIds.length,
        application: mapApp(updatedApplication),
        submission: mapSubmission(stored),
        event: mapEvent(event),
        documents: stored.documents.map(mapDoc),
      };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const replay = await loadSubmissionReplay(userId, input.idempotencyKey, acceptedReplayHashes);
        if (replay) return replay;
      }
      throw error;
    }
  }

  async listApplicationSubmissions(
    applicationId: string,
    userId: string,
    includeAnswers = false,
  ): Promise<ApplicationSubmissionRecord[]> {
    const owns = await prisma.application.count({ where: { id: nid(applicationId), userId } });
    if (!owns) throw new Error("not_found");
    const rows = await prisma.applicationSubmission.findMany({
      where: { applicationId: nid(applicationId), userId },
      orderBy: { submittedAt: "desc" },
      include: {
        documents: {
          include: { applications: { select: { id: true, company: true, role: true } } },
        },
      },
    });
    return rows.map((row) => mapSubmission(row, includeAnswers));
  }

  async listUserSubmissions(userId: string): Promise<ApplicationSubmissionRecord[]> {
    const rows = await prisma.applicationSubmission.findMany({
      where: { userId },
      orderBy: { submittedAt: "desc" },
    });
    return rows.map((row) => mapSubmission(row));
  }

  async getApplicationSubmission(
    id: string,
    userId: string,
  ): Promise<ApplicationSubmissionRecord | null> {
    const row = await prisma.applicationSubmission.findFirst({
      where: { id: nid(id), userId },
      include: {
        documents: {
          include: { applications: { select: { id: true, company: true, role: true } } },
        },
      },
    });
    return row ? mapSubmission(row) : null;
  }

  async createApplicationEvent(
    applicationId: string,
    userId: string,
    input: CreateApplicationEventInput,
  ): Promise<ApplicationEventRecord> {
    const requestHash = submissionRequestHash({
      applicationId,
      type: input.type,
      occurredAt: input.occurredAt,
      metadata: input.metadata ?? {},
    });
    const loadReplay = async (): Promise<ApplicationEventRecord | null> => {
      if (!input.idempotencyKey) return null;
      const replay = await prisma.applicationEvent.findUnique({
        where: {
          userId_idempotencyKey: { userId, idempotencyKey: input.idempotencyKey },
        },
      });
      if (!replay) return null;
      const application = await prisma.application.findFirst({ where: { id: nid(applicationId), userId } });
      if (!application) throw new Error("not_found");
      assertEventMatchesParent(replay, application);
      const legacyHash = ((replay.metadata ?? {}) as Record<string, unknown>).requestHash;
      if ((replay.requestHash ?? legacyHash) !== requestHash) throw new Error("idempotency_conflict");
      return mapEvent(replay);
    };
    const replay = await loadReplay();
    if (replay) return replay;
    try {
      const row = await prisma.$transaction(async (tx) => {
        const application = await tx.application.findFirst({ where: { id: nid(applicationId), userId } });
        if (!application) throw new Error("not_found");
        eventDemoData(application, requestHash);
        const bumped = await tx.application.updateMany({
          where: { id: nid(applicationId), userId },
          data: { eventVersion: { increment: 1 } },
        });
        if (bumped.count !== 1) throw new Error("not_found");
        return tx.applicationEvent.create({
          data: {
            userId,
            applicationId: nid(applicationId),
            type: input.type,
            idempotencyKey: input.idempotencyKey ?? null,
            requestHash,
            occurredAt: input.occurredAt,
            source: input.source ?? null,
            actor: input.actor ?? null,
            metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
            ...eventDemoData(application, requestHash),
          },
        });
      });
      return mapEvent(row);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const concurrentReplay = await loadReplay();
        if (concurrentReplay) return concurrentReplay;
      }
      throw error;
    }
  }

  async recordApplicationEvent(
    applicationId: string,
    userId: string,
    input: RecordApplicationEventInput,
  ): Promise<RecordApplicationEventResult> {
    const applicationNumericId = nid(applicationId);
    const requestHash = submissionRequestHash({
      applicationId,
      type: input.type,
      occurredAt: input.occurredAt,
      source: input.source ?? null,
      actor: input.actor ?? null,
      metadata: input.metadata ?? {},
      contactId: input.contactId ?? null,
      outcome: input.outcome ?? null,
      expectedUpdatedAt: input.expectedUpdatedAt ?? null,
    });
    const legacyRequestHash = submissionRequestHash({
      applicationId,
      type: input.type,
      occurredAt: input.occurredAt,
      metadata: input.metadata ?? {},
    });
    const acceptedRequestHashes = new Set([requestHash, legacyRequestHash]);

    const loadReplay = async (): Promise<RecordApplicationEventResult | null> => {
      if (!input.idempotencyKey) return null;
      const event = await prisma.applicationEvent.findUnique({
        where: { userId_idempotencyKey: { userId, idempotencyKey: input.idempotencyKey } },
      });
      if (!event) return null;
      const persistedRequestHash = event.requestHash ?? (
        event.metadata && typeof event.metadata === "object" && !Array.isArray(event.metadata)
          ? (event.metadata as Record<string, unknown>).requestHash
          : undefined
      );
      if (typeof persistedRequestHash !== "string" || !acceptedRequestHashes.has(persistedRequestHash)) {
        throw new Error("idempotency_conflict");
      }
      const application = await prisma.application.findFirst({
        where: { id: applicationNumericId, userId },
        include: { contacts: true },
      });
      if (!application) throw new Error("not_found");
      assertEventMatchesParent(event, application);
      return { event: mapEvent(event), application: mapApp(application), replayed: true };
    };

    const replay = await loadReplay();
    if (replay) return replay;

    try {
      return await prisma.$transaction(async (tx) => {
        const application = await tx.application.findFirst({
          where: { id: applicationNumericId, userId },
          include: { contacts: true },
        });
        if (!application) throw new Error("not_found");
        eventDemoData(application, requestHash);
        if (input.expectedUpdatedAt && application.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()) {
          throw new Error("conflict");
        }
        if (input.idempotencyKey) {
          const existing = await tx.applicationEvent.findUnique({
            where: { userId_idempotencyKey: { userId, idempotencyKey: input.idempotencyKey } },
          });
          if (existing) {
            const persistedRequestHash = existing.requestHash ?? (
              existing.metadata && typeof existing.metadata === "object" && !Array.isArray(existing.metadata)
                ? (existing.metadata as Record<string, unknown>).requestHash
                : undefined
            );
            if (typeof persistedRequestHash !== "string" || !acceptedRequestHashes.has(persistedRequestHash)) {
              throw new Error("idempotency_conflict");
            }
            assertEventMatchesParent(existing, application);
            return { event: mapEvent(existing), application: mapApp(application), replayed: true };
          }
        }

        const metadataInput = input.metadata ?? {};
        const referenceId = (value: string, errorCode: string) => {
          try {
            return nid(value);
          } catch {
            throw new Error(errorCode);
          }
        };
        if (input.contactId) {
          const count = await tx.contact.count({
            where: { id: referenceId(input.contactId, "contact_not_found"), applicationId: applicationNumericId },
          });
          if (count !== 1) throw new Error("contact_not_found");
        }
        const documentId = typeof metadataInput.documentId === "string" ? metadataInput.documentId : null;
        if (documentId) {
          const count = await tx.document.count({
            where: {
              id: referenceId(documentId, "document_not_found"),
              userId,
              applications: { some: { id: applicationNumericId } },
            },
          });
          if (count !== 1) throw new Error("document_not_found");
        }
        const submissionId = typeof metadataInput.submissionId === "string" ? metadataInput.submissionId : null;
        if (submissionId) {
          const count = await tx.applicationSubmission.count({
            where: {
              id: referenceId(submissionId, "submission_not_found"),
              userId,
              applicationId: applicationNumericId,
            },
          });
          if (count !== 1) throw new Error("submission_not_found");
        }

        const { patch, metadata } = deriveEventProjection(
          { type: input.type, occurredAt: input.occurredAt, metadata: metadataInput },
          {
          status: application.status,
          currentStage: application.currentStage,
          followUpAt: application.followUpAt,
        });
        const eventVersion = application.eventVersion;
        const updated = await tx.application.updateMany({
          where: { id: applicationNumericId, userId, eventVersion },
          data: { ...patch, eventVersion: { increment: 1 } },
        });
        if (updated.count !== 1) throw new Error("conflict");
        const updatedApplication = await tx.application.findFirst({
          where: { id: applicationNumericId, userId },
          include: { contacts: true },
        });
        if (!updatedApplication) throw new Error("not_found");
        const event = await tx.applicationEvent.create({
          data: {
            userId,
            applicationId: applicationNumericId,
            type: input.type,
            idempotencyKey: input.idempotencyKey ?? null,
            requestHash,
            occurredAt: input.occurredAt,
            source: input.source ?? null,
            actor: input.actor ?? null,
            contactId: input.contactId ?? null,
            outcome: input.outcome ?? null,
            metadata: metadata as Prisma.InputJsonValue,
            ...eventDemoData(updatedApplication, requestHash),
          },
        });
        return {
          event: mapEvent(event),
          application: mapApp(updatedApplication),
          replayed: false,
        };
      });
    } catch (error) {
      if (
        input.idempotencyKey
        && error instanceof Error
        && error.message === "conflict"
      ) {
        const concurrentReplay = await loadReplay();
        if (concurrentReplay) return concurrentReplay;
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const concurrentReplay = await loadReplay();
        if (concurrentReplay) return concurrentReplay;
      }
      throw error;
    }
  }

  async listApplicationEventsFiltered(
    userId: string,
    filter: ListApplicationEventsFilter,
    options?: DemoReadOptions,
  ): Promise<ApplicationEventPage> {
    const direction = filter.order === "oldest" ? "asc" : "desc";
    const applicationWhere: Prisma.ApplicationWhereInput = {
      userId,
      ...demoWhere(options),
      ...(filter.company ? { company: { contains: filter.company, mode: "insensitive" } } : {}),
    };
    const where: Prisma.ApplicationEventWhereInput = {
      userId,
      ...demoWhere(options),
      application: applicationWhere,
      ...(filter.applicationId ? { applicationId: nid(filter.applicationId) } : {}),
      ...(filter.types?.length ? { type: { in: filter.types } } : {}),
      ...(filter.source ? { source: filter.source } : {}),
      ...(filter.actor ? { actor: filter.actor } : {}),
      ...(filter.contactId ? { contactId: filter.contactId } : {}),
      ...(filter.outcome ? { outcome: filter.outcome } : {}),
    };
    const occurredAt: Prisma.DateTimeFilter = {};
    if (filter.occurredAfter) occurredAt.gte = filter.occurredAfter;
    if (filter.occurredBefore) occurredAt.lte = filter.occurredBefore;
    if (Object.keys(occurredAt).length) where.occurredAt = occurredAt;
    if (filter.cursor) {
      const cursorDate = new Date(filter.cursor.occurredAt);
      const cursorId = nid(filter.cursor.id);
      const cursorPredicate: Prisma.ApplicationEventWhereInput = filter.order === "oldest"
        ? { OR: [{ occurredAt: { gt: cursorDate } }, { occurredAt: cursorDate, id: { gt: cursorId } }] }
        : { OR: [{ occurredAt: { lt: cursorDate } }, { occurredAt: cursorDate, id: { lt: cursorId } }] };
      where.AND = [cursorPredicate];
    }
    const rows = await prisma.applicationEvent.findMany({
      where,
      orderBy: [{ occurredAt: direction }, { id: direction }],
      take: filter.limit + 1,
      include: { application: { select: { id: true, company: true, role: true } } },
    });
    const hasMore = rows.length > filter.limit;
    const pageRows = hasMore ? rows.slice(0, filter.limit) : rows;
    const items = pageRows.map(mapEvent);
    const last = items.at(-1);
    return {
      items,
      nextCursor: hasMore && last
        ? encodeEventCursor({ version: 1, occurredAt: last.occurredAt.toISOString(), id: last.id })
        : null,
    };
  }

  async listApplicationEvents(
    applicationId: string,
    userId: string,
    limit = 100,
    options?: DemoReadOptions,
  ): Promise<ApplicationEventRecord[]> {
    const owns = await prisma.application.count({
      where: { id: nid(applicationId), userId, ...demoWhere(options) },
    });
    if (!owns) throw new Error("not_found");
    const rows = await prisma.applicationEvent.findMany({
      where: {
        applicationId: nid(applicationId),
        userId,
        ...demoWhere(options),
        application: { userId, ...demoWhere(options) },
      },
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      take: Math.max(1, Math.min(500, limit)),
    });
    return rows.map(mapEvent);
  }

  async listApplicationsFiltered(
    userId: string | null,
    filter: ListApplicationsFilter,
    options?: DemoReadOptions,
  ): Promise<Partial<ApplicationRecord>[]> {
    const where: Prisma.ApplicationWhereInput = { ...userWhere(userId), ...demoWhere(options) };

    if (filter.status?.length) {
      where.status = { in: filter.status };
    }
    if (filter.ratingGte !== undefined) {
      where.rating = { gte: filter.ratingGte };
    }
    if (filter.triageQualityGte !== undefined) {
      where.triageQuality = { gte: filter.triageQualityGte };
    }
    if (filter.remote !== undefined) {
      where.remote = filter.remote;
    }
    if (filter.search) {
      const term = filter.search;
      where.OR = [
        { company: { contains: term, mode: "insensitive" } },
        { role: { contains: term, mode: "insensitive" } },
        { notes: { contains: term, mode: "insensitive" } },
        { jobDescription: { contains: term, mode: "insensitive" } },
      ];
    }

    // Sort
    let orderBy: Prisma.ApplicationOrderByWithRelationInput = { createdAt: "desc" };
    if (filter.sort) {
      const desc = filter.sort.startsWith("-");
      const field = desc ? filter.sort.slice(1) : filter.sort;
      const allowedSortFields = [
        "createdAt", "updatedAt", "company", "role", "status",
        "rating", "salaryMin", "salaryMax", "appliedAt", "lastContact",
        "triageQuality",
      ];
      if (allowedSortFields.includes(field)) {
        orderBy = { [field]: desc ? "desc" : "asc" };
      }
    }

    const includeContacts = filter.includeContacts ?? false;

    if (includeContacts) {
      const rows = await prisma.application.findMany({
        where,
        orderBy,
        take: filter.limit ?? undefined,
        include: { contacts: true },
      });
      return pickFields(rows.map(mapApp), filter.fields);
    }

    const rows = await prisma.application.findMany({
      where,
      orderBy,
      take: filter.limit ?? undefined,
    });
    // Map without contacts — give mapApp an empty contacts array to satisfy the type
    const mapped = rows.map((row) => mapApp({ ...row, contacts: [] }));
    return pickFields(mapped, filter.fields);
  }

  async batchUpsertApplications(userId: string, items: BatchUpsertItem[]): Promise<BatchUpsertResult> {
    const results: BatchUpsertResult["results"] = [];
    let succeeded = 0;
    let failed = 0;

    // Process each item independently so one failure doesn't poison the rest.
    // No outer transaction — partial success is the intended behaviour.
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      try {
        if (item.id) {
          const lifecycleFields = ["status", "appliedAt", "lastContact", "followUpAt", "currentStage"] as const;
          if (lifecycleFields.some((field) => item[field] !== undefined)) {
            results.push({ index: i, id: item.id, operation: "updated", error: "lifecycle_event_required" });
            failed++;
            continue;
          }
          // Pre-check ownership to avoid a throwing update on missing rows
          const existing = await prisma.application.findFirst({
            where: { id: nid(item.id), userId },
            select: { id: true },
          });
          if (!existing) {
            results.push({ index: i, id: item.id, operation: "updated", error: "Not found or access denied" });
            failed++;
            continue;
          }

          const data: Record<string, unknown> = {};
          if (item.company !== undefined) data.company = item.company;
          if (item.role !== undefined) data.role = item.role;
          if (item.status !== undefined) data.status = normalizeStatus(item.status);
          if (item.appliedAt !== undefined) data.appliedAt = item.appliedAt;
          if (item.lastContact !== undefined) data.lastContact = item.lastContact;
          if (item.followUpAt !== undefined) data.followUpAt = item.followUpAt;
          if (item.notes !== undefined) data.notes = validateApplicationSummary(item.notes);
          if (item.jobDescription !== undefined) data.jobDescription = item.jobDescription;
          if (item.source !== undefined) data.source = item.source;
          if (item.remote !== undefined) data.remote = item.remote;
          if (item.salaryMin !== undefined) data.salaryMin = item.salaryMin;
          if (item.salaryMax !== undefined) data.salaryMax = item.salaryMax;
          if (item.rating !== undefined) data.rating = item.rating;
          if (item.jobUrl !== undefined) data.jobUrl = item.jobUrl;
          if (item.resumeId !== undefined) data.resumeId = item.resumeId;
          Object.assign(data, structuredApplicationData(item as unknown as Record<string, unknown>));
          Object.assign(data, sanitizeTriageFields(item as Record<string, unknown>));
          data.eventVersion = { increment: 1 };

          const row = await prisma.application.update({
            where: { id: nid(item.id), userId },
            data,
          });
          results.push({ index: i, id: sid(row.id), operation: "updated" });
          succeeded++;
        } else {
          // Create - company and role are required
          if (!item.company || !item.role) {
            results.push({ index: i, id: "", operation: "created", error: "company and role are required for new applications" });
            failed++;
            continue;
          }
          const company = item.company;
          const role = item.role;
          const row = await prisma.$transaction(async (tx) => {
            const owner = await tx.$queryRaw<Array<{ id: string }>>`
              SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE
            `;
            if (!owner.length) throw new Error("user_not_found");
            if (await tx.demoWorkspace.count({ where: { userId } })) throw new Error("demo_workspace_exists");
            return tx.application.create({
              data: {
                userId,
                company,
                role,
                status: normalizeStatus(item.status || "inbound"),
                appliedAt: resolveAppliedAtForCreate(item.status || "inbound", item.appliedAt),
                lastContact: item.lastContact ?? null,
                followUpAt: item.followUpAt ?? null,
                notes: validateApplicationSummary(item.notes),
                jobDescription: item.jobDescription ?? null,
                source: item.source ?? null,
                remote: item.remote ?? false,
                salaryMin: item.salaryMin ?? null,
                salaryMax: item.salaryMax ?? null,
                rating: item.rating ?? null,
                jobUrl: item.jobUrl ?? null,
                resumeId: item.resumeId ?? null,
                ...structuredApplicationData(item as unknown as Record<string, unknown>),
                ...sanitizeTriageFields({
                  companySize: item.companySize ?? null,
                  salaryBandMentioned: item.salaryBandMentioned ?? false,
                  triageQuality: item.triageQuality ?? null,
                  triageReason: item.triageReason ?? null,
                  incomingSource: item.incomingSource ?? null,
                  autoRejected: item.autoRejected ?? false,
                  autoRejectReason: item.autoRejectReason ?? null,
                }),
              },
            });
          });
          results.push({ index: i, id: sid(row.id), operation: "created" });
          succeeded++;
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Unknown error";
        results.push({ index: i, id: item.id ?? "", operation: item.id ? "updated" : "created", error: msg });
        failed++;
      }
    }

    return { total: items.length, succeeded, failed, results };
  }

  async batchDeleteApplications(ids: string[], userId: string): Promise<BatchDeleteResult> {
    const results: BatchDeleteResult["results"] = [];
    let succeeded = 0;
    let failed = 0;

    for (const id of ids) {
      try {
        await this.deleteApplication(id, userId);
        results.push({ id, deleted: true });
        succeeded++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Unknown error";
        results.push({ id, deleted: false, error: msg });
        failed++;
      }
    }

    return { total: ids.length, succeeded, failed, results };
  }

  // Contacts

  async verifyApplicationOwner(id: string, userId: string): Promise<boolean> {
    const app = await prisma.application.findFirst({
      where: { id: nid(id), userId },
      select: { id: true },
    });
    return !!app;
  }

  async createContact(applicationId: string, userId: string, data: CreateContactInput): Promise<ContactRecord> {
    const applicationNumericId = nid(applicationId);
    const row = await prisma.$transaction(async (tx) => {
      const application = await tx.application.findFirst({
        where: { id: applicationNumericId, userId },
        select: { id: true },
      });
      if (!application) throw new Error("not_found");
      return tx.contact.create({ data: { applicationId: applicationNumericId, ...data } });
    });
    return mapContact(row);
  }

  async updateContact(id: string, applicationId: string, userId: string, data: UpdateContactInput): Promise<ContactRecord> {
    const row = await prisma.contact.update({
      where: {
        id: nid(id),
        applicationId: nid(applicationId),
        application: { userId },
      },
      data,
    });
    return mapContact(row);
  }

  async deleteContact(id: string, applicationId: string, userId: string): Promise<void> {
    await prisma.contact.delete({
      where: {
        id: nid(id),
        applicationId: nid(applicationId),
        application: { userId },
      },
    });
  }

  // Documents

  async listDocumentsByApplication(applicationId: string, userId: string): Promise<DocumentRecord[]> {
    const rows = await prisma.document.findMany({
      where: { userId, applications: { some: { id: nid(applicationId) } } },
      orderBy: { uploadedAt: "desc" },
      include: { applications: { select: { id: true, company: true, role: true } } },
    });
    return rows.map(mapDoc);
  }

  async listDocuments(userId: string | null): Promise<DocumentRecord[]> {
    const rows = await prisma.document.findMany({
      where: { ...userWhere(userId) },
      orderBy: { uploadedAt: "desc" },
      include: { applications: { select: { id: true, company: true, role: true } } },
    });
    return rows.map(mapDoc);
  }

  async listDocumentsFiltered(
    userId: string | null,
    filter: ListDocumentsFilter,
  ): Promise<Partial<DocumentRecord>[]> {
    const where: Prisma.DocumentWhereInput = { ...userWhere(userId) };
    const applicationPredicates: Prisma.DocumentWhereInput[] = [];
    if (filter.applicationId) {
      applicationPredicates.push({ applications: { some: { id: nid(filter.applicationId) } } });
    }
    if (filter.documentType) where.documentType = filter.documentType;
    if (filter.state) where.state = filter.state;
    if (filter.submissionId) where.submissionId = nid(filter.submissionId);
    if (filter.excludeSubmissionArtifacts) {
      where.submissionId = null;
      where.state = { notIn: ["submitted", "historical"] };
    }
    if (filter.orphaned === true) applicationPredicates.push({ applications: { none: {} } });
    if (filter.orphaned === false) applicationPredicates.push({ applications: { some: {} } });
    if (applicationPredicates.length) where.AND = applicationPredicates;
    const pageSize = Math.max(1, Math.min(200, filter.pageSize ?? filter.limit ?? 50));
    const page = Math.max(1, filter.page ?? 1);
    const rows = await prisma.document.findMany({
      where,
      orderBy: { uploadedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { applications: { select: { id: true, company: true, role: true } } },
    });
    return pickDocumentFields(rows.map(mapDoc), filter.fields);
  }

  async getDocument(id: string, userId: string | null): Promise<DocumentRecord | null> {
    const row = await prisma.document.findFirst({
      where: { id: nid(id), ...userWhere(userId) },
      include: { applications: { select: { id: true, company: true, role: true } } },
    });
    return row ? mapDoc(row) : null;
  }

  async updateDocumentMetadata(
    id: string,
    userId: string,
    data: UpdateDocumentMetadataInput,
    options?: DocumentMutationOptions,
  ): Promise<DocumentRecord> {
    const documentId = nid(id);
    return prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ submissionId: number | null; state: string }>>`
        SELECT "submissionId", "state"
        FROM "Document"
        WHERE "id" = ${documentId} AND "userId" = ${userId}
        FOR UPDATE
      `;
      if (!locked.length) throw new Error("not_found");
      const existing = await tx.document.findFirstOrThrow({
        where: { id: documentId, userId },
        include: { applications: { select: { id: true, userId: true, isDemo: true } } },
      });
      if (
        options?.requireNonDemoProvenance
        && (existing.demoProvenance || existing.applications.length > 0)
        && !existing.applications.some((application) => application.userId === userId && !application.isDemo)
      ) throw new Error("not_found");
      const keys = Object.keys(data);
      const stateOnly = keys.every((key) => key === "state");
      const immutable = existing.submissionId !== null || existing.state === "submitted" || existing.state === "historical";
      if (immutable) {
        const allowedState = data.state === existing.state
          || (existing.state === "submitted" && data.state === "historical");
        if (!stateOnly || !allowedState) throw new Error("submitted_document_immutable");
      } else if (data.state === "submitted") {
        throw new Error("submitted_state_reserved");
      }
      const row = await tx.document.update({
        where: { id: documentId, userId },
        data,
        include: { applications: { select: { id: true, company: true, role: true } } },
      });
      return mapDoc(row);
    });
  }

  async createDocument(userId: string, data: CreateDocumentInput, options?: DocumentMutationOptions): Promise<DocumentRecord> {
    const { applicationIds, submissionId, ...rest } = data;
    if (submissionId || rest.state === "submitted") throw new Error("submitted_state_reserved");
    const requestedApplicationIds = Array.from(new Set(applicationIds.map(nid)));
    const row = await prisma.$transaction(async (tx) => {
      const owner = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE
      `;
      if (!owner.length) throw new Error("user_not_found");
      const owned = requestedApplicationIds.length
        ? await tx.application.findMany({
            where: {
              id: { in: requestedApplicationIds },
              userId,
              ...(options?.requireNonDemoProvenance ? { isDemo: false } : {}),
            },
            select: { id: true, isDemo: true },
          })
        : [];
      if (owned.length !== requestedApplicationIds.length) throw new Error("invalid_applications");
      return tx.document.create({
        data: {
          userId,
          ...rest,
          submissionId: null,
          demoProvenance: owned.some((application) => application.isDemo),
          applications: requestedApplicationIds.length
            ? { connect: requestedApplicationIds.map((id) => ({ id })) }
            : undefined,
        },
        include: { applications: { select: { id: true, company: true, role: true } } },
      });
    });
    return mapDoc(row);
  }

  async updateDocumentLinks(id: string, userId: string, applicationIds: string[], options?: DocumentMutationOptions): Promise<DocumentRecord> {
    const documentId = nid(id);
    const requestedApplicationIds = Array.from(new Set(applicationIds)).map(nid);
    return prisma.$transaction(async (tx) => {
      const owner = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE
      `;
      if (!owner.length) throw new Error("user_not_found");
      const locked = await tx.$queryRaw<Array<{ submissionId: number | null; state: string }>>`
        SELECT "submissionId", "state"
        FROM "Document"
        WHERE "id" = ${documentId} AND "userId" = ${userId}
        FOR UPDATE
      `;
      if (!locked.length) throw new Error("not_found");
      const existing = await tx.document.findFirstOrThrow({
        where: { id: documentId, userId },
        include: { applications: { select: { id: true, userId: true, isDemo: true } } },
      });
      if (
        options?.requireNonDemoProvenance
        && (existing.demoProvenance || existing.applications.length > 0)
        && !existing.applications.some((application) => application.userId === userId && !application.isDemo)
      ) throw new Error("not_found");
      if (locked[0].submissionId !== null || locked[0].state === "submitted" || locked[0].state === "historical") {
        throw new Error("submitted_document_immutable");
      }
      const owned = await tx.application.findMany({
        where: {
          id: { in: requestedApplicationIds },
          userId,
          ...(options?.requireNonDemoProvenance ? { isDemo: false } : {}),
        },
        select: { id: true, isDemo: true },
      });
      if (owned.length !== requestedApplicationIds.length) throw new Error("invalid_applications");
      const row = await tx.document.update({
        where: { id: documentId, userId },
        data: {
          demoProvenance: existing.demoProvenance || owned.some((application) => application.isDemo),
          applications: { set: owned.map((application) => ({ id: application.id })) },
        },
        include: { applications: { select: { id: true, company: true, role: true } } },
      });
      return mapDoc(row);
    });
  }

  async renameDocument(id: string, userId: string, newName: string): Promise<DocumentRecord | null> {
    const documentId = nid(id);
    const changed = await prisma.document.updateMany({
      where: { id: documentId, userId, submissionId: null, state: { notIn: ["submitted", "historical"] } },
      data: { originalName: newName },
    });
    if (changed.count === 1) return this.getDocument(id, userId);
    const existing = await prisma.document.findFirst({
      where: { id: documentId, userId },
      select: { submissionId: true, state: true },
    });
    if (!existing) return null;
    throw new Error("submitted_document_immutable");
  }

  async deleteDocument(id: string, userId: string, options?: DocumentMutationOptions): Promise<DocumentRecord | null> {
    const documentId = nid(id);
    return prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ submissionId: number | null; state: string }>>`
        SELECT "submissionId", "state"
        FROM "Document"
        WHERE "id" = ${documentId} AND "userId" = ${userId}
        FOR UPDATE
      `;
      if (!locked.length) return null;
      const provenance = await tx.document.findFirstOrThrow({
        where: { id: documentId, userId },
        include: { applications: { select: { id: true, userId: true, isDemo: true } } },
      });
      if (
        options?.requireNonDemoProvenance
        && (provenance.demoProvenance || provenance.applications.length > 0)
        && !provenance.applications.some((application) => application.userId === userId && !application.isDemo)
      ) throw new Error("not_found");
      if (locked[0].submissionId !== null || locked[0].state === "submitted" || locked[0].state === "historical") {
        throw new Error("submitted_document_immutable");
      }
      const document = await tx.document.findFirstOrThrow({
        where: { id: documentId, userId },
      });
      await tx.shareLink.deleteMany({ where: { userId, targetType: "document", targetId: id } });
      await tx.document.delete({ where: { id: documentId, userId } });
      return mapDoc(document);
    });
  }

  // Users

  async getUser(id: string): Promise<UserRecord | null> {
    const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true, name: true, email: true, isAdmin: true },
    });
    return user;
  }

  async listUsers(): Promise<UserRecord[]> {
    return prisma.user.findMany({
      orderBy: [{ isAdmin: "desc" }, { email: "asc" }],
      select: { id: true, name: true, email: true, isAdmin: true },
    });
  }

  async updateUserAdmin(id: string, isAdmin: boolean): Promise<UserRecord> {
    return prisma.user.update({
      where: { id },
      data: { isAdmin },
      select: { id: true, name: true, email: true, isAdmin: true },
    });
  }

  // Audit Logs

  async createAuditLog(actorId: string, action: string, targetId: string): Promise<void> {
    await prisma.adminAuditLog.create({
      data: { actorId, action, targetId },
    });
  }

  async listAuditLogs(limit = 50): Promise<AuditLogRecord[]> {
    const rows = await prisma.adminAuditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        actor: { select: { email: true } },
        target: { select: { email: true } },
      },
    });
    return rows.map((r) => ({
      id: sid(r.id),
      actorId: r.actorId,
      actorEmail: r.actor.email,
      action: r.action,
      targetId: r.targetId,
      targetEmail: r.target.email,
      createdAt: r.createdAt,
    }));
  }

  // API Tokens

  async getApiTokenByHash(tokenHash: string): Promise<ApiTokenRecord | null> {
    const row = await prisma.userApiToken.findUnique({
      where: { tokenHash },
    });
    return row ? { ...row, id: sid(row.id) } : null;
  }

  async getApiToken(userId: string): Promise<ApiTokenInfo | null> {
    const row = await prisma.userApiToken.findFirst({
      where: { userId },
      select: { id: true, name: true, createdAt: true, lastUsedAt: true },
    });
    return row ? { ...row, id: sid(row.id) } : null;
  }

  async createApiToken(userId: string, tokenHash: string, name = "default"): Promise<ApiTokenInfo> {
    // Delete existing token first (one token per user)
    await prisma.userApiToken.deleteMany({ where: { userId } });
    const row = await prisma.userApiToken.create({
      data: { userId, tokenHash, name },
      select: { id: true, name: true, createdAt: true, lastUsedAt: true },
    });
    return { ...row, id: sid(row.id) };
  }

  async deleteApiToken(userId: string): Promise<void> {
    await prisma.userApiToken.deleteMany({ where: { userId } });
  }

  async touchApiTokenLastUsed(id: string): Promise<void> {
    await prisma.userApiToken.update({
      where: { id: nid(id) },
      data: { lastUsedAt: new Date() },
    });
  }

  // Share Links

  async getShareLinkByCode(code: string): Promise<ShareLinkRecord | null> {
    const row = await prisma.shareLink.findUnique({ where: { code } });
    return row ? { ...row, id: sid(row.id) } : null;
  }

  async listShareLinks(userId: string): Promise<ShareLinkRecord[]> {
    const rows = await prisma.shareLink.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((row) => ({ ...row, id: sid(row.id) }));
  }

  async findShareLink(userId: string, targetType: string, targetId: string | null): Promise<ShareLinkRecord | null> {
    const row = await prisma.shareLink.findFirst({
      where: { userId, targetType, targetId },
    });
    return row ? { ...row, id: sid(row.id) } : null;
  }

  async createShareLink(userId: string, data: CreateShareLinkInput): Promise<ShareLinkRecord> {
    const row = await prisma.shareLink.create({
      data: { userId, ...data },
    });
    return { ...row, id: sid(row.id) };
  }

  async deleteShareLink(id: string, userId: string): Promise<void> {
    await prisma.shareLink.delete({ where: { id: nid(id), userId } });
  }

  // CV

  async getCvProfile(userId: string): Promise<CvProfileRecord | null> {
    const row = await prisma.cvProfile.findUnique({ where: { userId } });
    if (!row) return null;
    return mapCvProfile(row);
  }

  async upsertCvProfile(userId: string, data: UpsertCvProfileInput): Promise<CvProfileRecord> {
    const payload = {
      name: data.name,
      contact: data.contact as unknown as Prisma.InputJsonValue,
      profile: data.profile,
      skills: data.skills as unknown as Prisma.InputJsonValue,
      experience: data.experience as unknown as Prisma.InputJsonValue,
      projects: (data.projects ?? []) as unknown as Prisma.InputJsonValue,
      education: (data.education ?? []) as unknown as Prisma.InputJsonValue,
    };
    const row = await prisma.cvProfile.upsert({
      where: { userId },
      create: { userId, ...payload },
      update: payload,
    });
    return mapCvProfile(row);
  }

  async getCvPatch(applicationId: string, userId: string): Promise<CvPatchRecord | null> {
    const row = await prisma.cvPatch.findFirst({
      where: { applicationId: nid(applicationId), application: { userId } },
    });
    if (!row) return null;
    return {
      ...row,
      id: sid(row.id),
      applicationId: sid(row.applicationId),
      documentId: row.documentId ? sid(row.documentId) : null,
      experienceIds: row.experienceIds as string[],
      skillCategories: row.skillCategories as string[],
    };
  }

  async upsertCvPatch(applicationId: string, userId: string, data: UpsertCvPatchInput): Promise<CvPatchRecord> {
    const payload = {
      profileOverride: data.profileOverride ?? null,
      experienceIds: data.experienceIds as unknown as Prisma.InputJsonValue,
      skillCategories: data.skillCategories as unknown as Prisma.InputJsonValue,
      includeProjects: data.includeProjects ?? false,
      includeEducation: data.includeEducation ?? true,
    };
    const row = await prisma.$transaction(async (tx) => {
      const application = await tx.application.findFirst({
        where: { id: nid(applicationId), userId },
        select: { id: true },
      });
      if (!application) throw new Error("not_found");
      return tx.cvPatch.upsert({
        where: { applicationId: application.id },
        create: { applicationId: application.id, ...payload },
        update: payload,
      });
    });
    return {
      ...row,
      id: sid(row.id),
      applicationId: sid(row.applicationId),
      documentId: row.documentId ? sid(row.documentId) : null,
      experienceIds: row.experienceIds as string[],
      skillCategories: row.skillCategories as string[],
    };
  }

  async setCvPatchDocumentId(patchId: string, userId: string, documentId: string | null): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const patch = await tx.cvPatch.findFirst({
        where: { id: nid(patchId), application: { userId } },
        select: { id: true },
      });
      if (!patch) throw new Error("not_found");
      if (documentId) {
        const document = await tx.document.findFirst({
          where: { id: nid(documentId), userId },
          select: { id: true },
        });
        if (!document) throw new Error("not_found");
      }
      await tx.cvPatch.update({
        where: { id: patch.id },
        data: { documentId: documentId ? nid(documentId) : null },
      });
    });
  }

  // ── Career Ops (Hermes session bridge) ───────────────────────────────────

  async listCareerOpsThreads(userId: string): Promise<CareerOpsThreadRecord[]> {
    const rows = await prisma.careerOpsThread.findMany({
      where: { userId },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    });
    return rows.map(mapCareerOpsThread);
  }

  async getCareerOpsThread(id: string, userId: string): Promise<CareerOpsThreadRecord | null> {
    const row = await prisma.careerOpsThread.findFirst({ where: { id, userId } });
    return row ? mapCareerOpsThread(row) : null;
  }

  async createCareerOpsThread(
    userId: string,
    data: CreateCareerOpsThreadInput,
  ): Promise<CareerOpsThreadRecord> {
    const row = await prisma.careerOpsThread.create({
      data: {
        userId,
        hermesSessionId: data.hermesSessionId,
        title: data.title,
        applicationId: data.applicationId ? nid(data.applicationId) : null,
      },
    });
    return mapCareerOpsThread(row);
  }

  async renameCareerOpsThread(
    id: string,
    userId: string,
    title: string,
  ): Promise<CareerOpsThreadRecord | null> {
    const updated = await prisma.careerOpsThread.updateMany({
      where: { id, userId },
      data: { title },
    });
    if (updated.count === 0) return null;
    return this.getCareerOpsThread(id, userId);
  }

  async deleteCareerOpsThread(id: string, userId: string): Promise<CareerOpsThreadRecord | null> {
    const existing = await this.getCareerOpsThread(id, userId);
    if (!existing) return null;
    // Deleting the runs explicitly (rather than relying only on the database
    // cascade) keeps the observable behavior identical to the Firestore path.
    await prisma.careerOpsRun.deleteMany({ where: { threadId: id, userId } });
    await prisma.careerOpsThread.deleteMany({ where: { id, userId } });
    return existing;
  }

  async getCareerOpsRun(id: string, userId: string): Promise<CareerOpsRunRecord | null> {
    const row = await prisma.careerOpsRun.findFirst({ where: { id, userId } });
    return row ? mapCareerOpsRun(row) : null;
  }

  async createCareerOpsRun(
    userId: string,
    data: CreateCareerOpsRunInput,
  ): Promise<CreateCareerOpsRunResult> {
    const thread = await this.getCareerOpsThread(data.threadId, userId);
    if (!thread) throw new Error("career_ops_thread_not_found");

    const existing = await prisma.careerOpsRun.findFirst({
      where: { userId, threadId: data.threadId, clientRequestId: data.clientRequestId },
    });
    if (existing) return { run: mapCareerOpsRun(existing), created: false };

    try {
      const row = await prisma.careerOpsRun.create({
        data: {
          userId,
          threadId: data.threadId,
          hermesRunId: data.hermesRunId,
          clientRequestId: data.clientRequestId,
          status: data.status,
        },
      });
      return { run: mapCareerOpsRun(row), created: true };
    } catch (error) {
      // A concurrent duplicate won the unique index; return the winner so a
      // retry can never observe two runs for one client request.
      if ((error as { code?: string }).code !== "P2002") throw error;
      const winner = await prisma.careerOpsRun.findFirst({
        where: { userId, threadId: data.threadId, clientRequestId: data.clientRequestId },
      });
      if (!winner) throw error;
      return { run: mapCareerOpsRun(winner), created: false };
    }
  }

  async updateCareerOpsRunStatus(
    id: string,
    userId: string,
    status: CareerOpsRunStatus,
  ): Promise<void> {
    await prisma.careerOpsRun.updateMany({ where: { id, userId }, data: { status } });
  }
}

function mapCareerOpsThread(row: {
  id: string;
  userId: string;
  hermesSessionId: string;
  title: string;
  applicationId: number | null;
  createdAt: Date;
  updatedAt: Date;
}): CareerOpsThreadRecord {
  return {
    id: row.id,
    userId: row.userId,
    hermesSessionId: row.hermesSessionId,
    title: row.title,
    applicationId: row.applicationId === null ? null : sid(row.applicationId),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapCareerOpsRun(row: {
  id: string;
  userId: string;
  threadId: string;
  hermesRunId: string;
  clientRequestId: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}): CareerOpsRunRecord {
  return {
    id: row.id,
    userId: row.userId,
    threadId: row.threadId,
    hermesRunId: row.hermesRunId,
    clientRequestId: row.clientRequestId,
    status: row.status as CareerOpsRunStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
