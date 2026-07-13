import { prisma } from "@/lib/prisma";
import { Prisma, type ApplicationSubmission, type ApplicationEvent, type Document as PrismaDocument } from "@prisma/client";
import { normalizeStatus } from "@/types";
import { sanitizeTriageFields } from "./sanitize";
import { resolveAppliedAtForCreate } from "@/lib/applications/defaults";
import { submissionRequestHash } from "@/lib/applications/submission";
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
  ListDocumentsFilter,
  UpdateDocumentMetadataInput,
} from "./types";

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
    documentIds: row.documentIds as unknown as string[],
    documents: row.documents?.map(mapDoc),
  };
}

function mapEvent(row: ApplicationEvent): ApplicationEventRecord {
  return {
    ...row,
    id: sid(row.id),
    applicationId: sid(row.applicationId),
    metadata: row.metadata as unknown as Record<string, unknown> | null,
  };
}

function submissionEventKey(idempotencyKey: string): string {
  return `submission:${idempotencyKey}`;
}

async function loadSubmissionReplay(
  userId: string,
  idempotencyKey: string,
  requestHash: string,
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
  if (submission.requestHash !== requestHash) throw new Error("idempotency_conflict");
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
  return userId ? { userId } : {};
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
  // Applications

  async listApplications(userId: string | null): Promise<ApplicationRecord[]> {
    const rows = await prisma.application.findMany({
      where: { ...userWhere(userId) },
      orderBy: { createdAt: "desc" },
      include: { contacts: true },
    });
    return rows.map(mapApp);
  }

  async listApplicationsPaginated(
    userId: string | null,
    params: PaginationParams
  ): Promise<PaginatedResult<ApplicationRecord>> {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.max(1, Math.min(100, params.pageSize ?? 10));
    const where = { ...userWhere(userId) };

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

  async getApplication(id: string, userId: string | null): Promise<ApplicationRecord | null> {
    const row = await prisma.application.findFirst({
      where: { id: nid(id), ...userWhere(userId) },
      include: { contacts: true },
    });
    return row ? mapApp(row) : null;
  }

  async createApplication(userId: string, data: CreateApplicationInput): Promise<ApplicationRecord> {
    try {
      const row = await prisma.application.create({
        data: {
          userId,
          ...data,
          status: normalizeStatus(data.status),
          appliedAt: resolveAppliedAtForCreate(data.status, data.appliedAt),
        },
        include: { contacts: true },
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
    const { expectedUpdatedAt, ...update } = data;
    const applicationId = nid(id);
    try {
      if (expectedUpdatedAt) {
        const result = await prisma.application.updateMany({
          where: { id: applicationId, userId, updatedAt: expectedUpdatedAt },
          data: {
            ...update,
            ...(update.status !== undefined ? { status: normalizeStatus(update.status) } : {}),
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
  ): Promise<ApplicationRecord | null> {
    const row = await prisma.application.findFirst({
      where: { userId, canonicalJobUrl },
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
      const metadata = (event.metadata ?? {}) as Record<string, unknown>;
      if (metadata.requestHash !== requestHash) throw new Error("idempotency_conflict");
      const application = await prisma.application.findFirst({
        where: { id: nid(id), userId },
        include: { contacts: true },
      });
      if (!application) throw new Error("not_found");
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
            const metadata = (replay.metadata ?? {}) as Record<string, unknown>;
            if (metadata.requestHash !== requestHash) throw new Error("idempotency_conflict");
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
                  "updatedAt" = NOW()
              WHERE "id" = ${nid(id)}
                AND "userId" = ${userId}
                AND "updatedAt" = ${expectedUpdatedAt}
                AND char_length(
                  CASE
                    WHEN "notes" IS NULL OR "notes" = '' THEN ${note}
                    ELSE "notes" || E'\n\n' || ${note}
                  END
                ) <= 50000
            `
          : await tx.$executeRaw`
              UPDATE "Application"
              SET "notes" = CASE
                    WHEN "notes" IS NULL OR "notes" = '' THEN ${note}
                    ELSE "notes" || E'\n\n' || ${note}
                  END,
                  "updatedAt" = NOW()
              WHERE "id" = ${nid(id)}
                AND "userId" = ${userId}
                AND char_length(
                  CASE
                    WHEN "notes" IS NULL OR "notes" = '' THEN ${note}
                    ELSE "notes" || E'\n\n' || ${note}
                  END
                ) <= 50000
            `;
        if (changed !== 1) {
          const current = await tx.application.findFirst({ where: { id: nid(id), userId } });
          if (!current) throw new Error("not_found");
          if (expectedUpdatedAt && current.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
            throw new Error("conflict");
          }
          throw new Error("notes_too_large");
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
            occurredAt: eventInput.occurredAt,
            source: eventInput.source ?? null,
            actor: eventInput.actor ?? null,
            metadata: {
              ...(eventInput.metadata ?? {}),
              requestHash,
            } as Prisma.InputJsonValue,
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
    const hashable: Record<string, unknown> = { ...input };
    delete hashable.idempotencyKey;
    delete hashable.dryRun;
    delete hashable.expectedUpdatedAt;
    delete hashable.source;
    delete hashable.actor;
    const requestHash = submissionRequestHash(hashable);
    const initialReplay = await loadSubmissionReplay(userId, input.idempotencyKey, requestHash);
    if (initialReplay) return initialReplay;
    try {
      return await prisma.$transaction(async (tx) => {
      const replay = await tx.applicationSubmission.findUnique({
        where: { userId_idempotencyKey: { userId, idempotencyKey: input.idempotencyKey } },
        include: {
          documents: {
            include: { applications: { select: { id: true, company: true, role: true } } },
          },
        },
      });
      if (replay) {
        if (replay.requestHash !== requestHash) throw new Error("idempotency_conflict");
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

      const applicationId = nid(input.applicationId);
      const locked = await tx.$queryRaw<Array<{ id: number }>>`
        SELECT "id" FROM "Application"
        WHERE "id" = ${applicationId} AND "userId" = ${userId}
        FOR UPDATE
      `;
      if (!locked.length) throw new Error("not_found");
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

      const uniqueDocumentIds = Array.from(new Set(input.documentIds));
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
          atsName: input.atsName ?? application.atsName,
          requisitionId: input.requisitionId ?? application.requisitionId,
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
            atsName: input.atsName ?? null,
            requisitionId: input.requisitionId ?? null,
            language: input.language ?? null,
            answers: input.answers,
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
          atsName: input.atsName ?? null,
          requisitionId: input.requisitionId ?? null,
          language: input.language ?? null,
          answers: input.answers as unknown as Prisma.InputJsonValue,
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
          },
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
        const replay = await loadSubmissionReplay(userId, input.idempotencyKey, requestHash);
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
    const owns = await prisma.application.count({ where: { id: nid(applicationId), userId } });
    if (!owns) throw new Error("not_found");
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
      const metadata = (replay.metadata ?? {}) as Record<string, unknown>;
      if (metadata.requestHash !== requestHash) throw new Error("idempotency_conflict");
      return mapEvent(replay);
    };
    const replay = await loadReplay();
    if (replay) return replay;
    try {
      const row = await prisma.applicationEvent.create({
        data: {
          userId,
          applicationId: nid(applicationId),
          type: input.type,
          idempotencyKey: input.idempotencyKey ?? null,
          occurredAt: input.occurredAt,
          source: input.source ?? null,
          actor: input.actor ?? null,
          metadata: {
            ...(input.metadata ?? {}),
            requestHash,
          } as Prisma.InputJsonValue,
        },
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

  async listApplicationEvents(
    applicationId: string,
    userId: string,
    limit = 100,
  ): Promise<ApplicationEventRecord[]> {
    const owns = await prisma.application.count({ where: { id: nid(applicationId), userId } });
    if (!owns) throw new Error("not_found");
    const rows = await prisma.applicationEvent.findMany({
      where: { applicationId: nid(applicationId), userId },
      orderBy: { occurredAt: "desc" },
      take: Math.max(1, Math.min(500, limit)),
    });
    return rows.map(mapEvent);
  }

  async listApplicationsFiltered(
    userId: string | null,
    filter: ListApplicationsFilter
  ): Promise<Partial<ApplicationRecord>[]> {
    const where: Prisma.ApplicationWhereInput = { ...userWhere(userId) };

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
          if (item.notes !== undefined) data.notes = item.notes;
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
          const row = await prisma.application.create({
            data: {
              userId,
              company: item.company,
              role: item.role,
              status: normalizeStatus(item.status || "inbound"),
              appliedAt: resolveAppliedAtForCreate(item.status || "inbound", item.appliedAt),
              lastContact: item.lastContact ?? null,
              followUpAt: item.followUpAt ?? null,
              notes: item.notes ?? null,
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
  ): Promise<DocumentRecord> {
    const documentId = nid(id);
    const existing = await prisma.document.findFirst({ where: { id: documentId, userId } });
    if (!existing) throw new Error("not_found");
    const keys = Object.keys(data);
    const stateOnly = keys.every((key) => key === "state");
    const immutable = existing.submissionId !== null || existing.state === "submitted" || existing.state === "historical";
    if (immutable) {
      const allowedState = data.state === existing.state
        || (existing.state === "submitted" && data.state === "historical");
      if (!stateOnly || !allowedState) {
        throw new Error("submitted_document_immutable");
      }
    } else if (data.state === "submitted") {
      throw new Error("submitted_state_reserved");
    }
    const changed = await prisma.document.updateMany({
      where: {
        id: documentId,
        userId,
        submissionId: existing.submissionId,
        state: existing.state,
      },
      data,
    });
    if (changed.count !== 1) throw new Error("submitted_document_immutable");
    return (await this.getDocument(id, userId))!;
  }

  async createDocument(userId: string, data: CreateDocumentInput): Promise<DocumentRecord> {
    const { applicationIds, submissionId, ...rest } = data;
    if (submissionId || rest.state === "submitted") throw new Error("submitted_state_reserved");
    const requestedApplicationIds = Array.from(new Set(applicationIds.map(nid)));
    const row = await prisma.$transaction(async (tx) => {
      const owned = requestedApplicationIds.length
        ? await tx.application.findMany({
            where: { id: { in: requestedApplicationIds }, userId },
            select: { id: true },
          })
        : [];
      if (owned.length !== requestedApplicationIds.length) throw new Error("invalid_applications");
      return tx.document.create({
        data: {
          userId,
          ...rest,
          submissionId: null,
          applications: requestedApplicationIds.length
            ? { connect: requestedApplicationIds.map((id) => ({ id })) }
            : undefined,
        },
        include: { applications: { select: { id: true, company: true, role: true } } },
      });
    });
    return mapDoc(row);
  }

  async updateDocumentLinks(id: string, userId: string, applicationIds: string[]): Promise<DocumentRecord> {
    const documentId = nid(id);
    const requestedApplicationIds = Array.from(new Set(applicationIds)).map(nid);
    return prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ submissionId: number | null; state: string }>>`
        SELECT "submissionId", "state"
        FROM "Document"
        WHERE "id" = ${documentId} AND "userId" = ${userId}
        FOR UPDATE
      `;
      if (!locked.length) throw new Error("not_found");
      if (locked[0].submissionId !== null || locked[0].state === "submitted" || locked[0].state === "historical") {
        throw new Error("submitted_document_immutable");
      }
      const owned = await tx.application.findMany({
        where: { id: { in: requestedApplicationIds }, userId },
        select: { id: true },
      });
      if (owned.length !== requestedApplicationIds.length) throw new Error("invalid_applications");
      const row = await tx.document.update({
        where: { id: documentId, userId },
        data: { applications: { set: owned.map((application) => ({ id: application.id })) } },
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

  async deleteDocument(id: string, userId: string): Promise<DocumentRecord | null> {
    const documentId = nid(id);
    return prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ submissionId: number | null; state: string }>>`
        SELECT "submissionId", "state"
        FROM "Document"
        WHERE "id" = ${documentId} AND "userId" = ${userId}
        FOR UPDATE
      `;
      if (!locked.length) return null;
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

  async upsertCvPatch(applicationId: string, data: UpsertCvPatchInput): Promise<CvPatchRecord> {
    const payload = {
      profileOverride: data.profileOverride ?? null,
      experienceIds: data.experienceIds as unknown as Prisma.InputJsonValue,
      skillCategories: data.skillCategories as unknown as Prisma.InputJsonValue,
      includeProjects: data.includeProjects ?? false,
      includeEducation: data.includeEducation ?? true,
    };
    const row = await prisma.cvPatch.upsert({
      where: { applicationId: nid(applicationId) },
      create: { applicationId: nid(applicationId), ...payload },
      update: payload,
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

  async setCvPatchDocumentId(patchId: string, documentId: string | null): Promise<void> {
    await prisma.cvPatch.update({
      where: { id: nid(patchId) },
      data: { documentId: documentId ? nid(documentId) : null },
    });
  }
}
