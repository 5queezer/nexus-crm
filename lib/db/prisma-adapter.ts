import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { normalizeStatus } from "@/types";
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
} from "./types";

// ── Helpers: convert Prisma int IDs ↔ string IDs ────────────────────────────

function sid(n: number): string {
  return String(n);
}

function nid(s: string): number {
  return parseInt(s, 10);
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
    contacts: a.contacts?.map(mapContact),
  };
}

function mapDoc(d: { id: number; userId: string; filename: string; originalName: string; size: number; mimeType: string; uploadedAt: Date; applications?: { id: number; company: string; role: string }[] }): DocumentRecord {
  return {
    ...d,
    id: sid(d.id),
    applications: d.applications?.map((a) => ({ id: sid(a.id), company: a.company, role: a.role })),
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
    const row = await prisma.application.create({
      data: { userId, ...data, status: normalizeStatus(data.status) },
      include: { contacts: true },
    });
    return mapApp(row);
  }

  async updateApplication(id: string, userId: string, data: UpdateApplicationInput): Promise<ApplicationRecord> {
    const row = await prisma.application.update({
      where: { id: nid(id), userId },
      data: {
        ...data,
        ...(data.status !== undefined ? { status: normalizeStatus(data.status) } : {}),
      },
      include: { contacts: true },
    });
    return mapApp(row);
  }

  async deleteApplication(id: string, userId: string): Promise<void> {
    await prisma.application.delete({ where: { id: nid(id), userId } });
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
              status: normalizeStatus(item.status || "applied"),
              appliedAt: item.appliedAt ?? null,
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

    // Process each delete independently — use deleteMany to avoid throwing on
    // missing/unauthorized rows (returns count instead of P2025 error).
    for (const id of ids) {
      try {
        const { count } = await prisma.application.deleteMany({
          where: { id: nid(id), userId },
        });
        if (count > 0) {
          results.push({ id, deleted: true });
          succeeded++;
        } else {
          results.push({ id, deleted: false, error: "Not found or access denied" });
          failed++;
        }
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

  async createContact(applicationId: string, data: CreateContactInput): Promise<ContactRecord> {
    const row = await prisma.contact.create({
      data: { applicationId: nid(applicationId), ...data },
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

  async getDocument(id: string, userId: string | null): Promise<DocumentRecord | null> {
    const row = await prisma.document.findFirst({
      where: { id: nid(id), ...userWhere(userId) },
    });
    return row ? mapDoc(row) : null;
  }

  async createDocument(userId: string, data: CreateDocumentInput): Promise<DocumentRecord> {
    const { applicationIds, ...rest } = data;

    // Verify all referenced applications belong to this user
    let safeIds: number[] = [];
    if (applicationIds.length > 0) {
      const owned = await prisma.application.findMany({
        where: { id: { in: applicationIds.map(nid) }, userId },
        select: { id: true },
      });
      safeIds = owned.map((a) => a.id);
    }

    const row = await prisma.document.create({
      data: {
        userId,
        ...rest,
        applications: safeIds.length ? { connect: safeIds.map((id) => ({ id })) } : undefined,
      },
      include: { applications: { select: { id: true, company: true, role: true } } },
    });
    return mapDoc(row);
  }

  async updateDocumentLinks(id: string, userId: string, applicationIds: string[]): Promise<DocumentRecord> {
    const owned = await prisma.application.findMany({
      where: { id: { in: applicationIds.map(nid) }, userId },
      select: { id: true },
    });

    const row = await prisma.document.update({
      where: { id: nid(id), userId },
      data: { applications: { set: owned.map((a) => ({ id: a.id })) } },
      include: { applications: { select: { id: true, company: true, role: true } } },
    });
    return mapDoc(row);
  }

  async renameDocument(id: string, userId: string, newName: string): Promise<DocumentRecord | null> {
    const existing = await prisma.document.findFirst({ where: { id: nid(id), userId } });
    if (!existing) return null;
    const row = await prisma.document.update({
      where: { id: nid(id), userId },
      data: { originalName: newName },
      include: { applications: { select: { id: true, company: true, role: true } } },
    });
    return mapDoc(row);
  }

  async deleteDocument(id: string, userId: string): Promise<DocumentRecord | null> {
    const doc = await prisma.document.findFirst({ where: { id: nid(id), userId } });
    if (!doc) return null;
    await prisma.shareLink.deleteMany({ where: { userId, targetType: "document", targetId: id } });
    await prisma.document.delete({ where: { id: nid(id), userId } });
    return mapDoc(doc);
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
