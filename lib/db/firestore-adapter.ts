import { getFirestore, Timestamp, FieldValue } from "firebase-admin/firestore";
import { getApps, initializeApp, applicationDefault } from "firebase-admin/app";
import { prisma } from "@/lib/prisma";
import { normalizeStatus } from "@/types";
import { sanitizeTriageFields } from "./sanitize";
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

// ── Firestore init ──────────────────────────────────────────────────────────

function getDb() {
  if (getApps().length === 0) {
    initializeApp({ credential: applicationDefault() });
  }
  return getFirestore();
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function toDate(v: Timestamp | null | undefined): Date | null {
  return v ? v.toDate() : null;
}

function toTimestamp(v: Date | null | undefined): Timestamp | null {
  return v ? Timestamp.fromDate(v) : null;
}

function mapApp(id: string, data: FirebaseFirestore.DocumentData): ApplicationRecord {
  return {
    id,
    userId: data.userId,
    company: data.company,
    role: data.role,
    status: normalizeStatus(data.status),
    appliedAt: toDate(data.appliedAt),
    lastContact: toDate(data.lastContact),
    followUpAt: toDate(data.followUpAt),
    notes: data.notes ?? null,
    jobDescription: data.jobDescription ?? null,
    source: data.source ?? null,
    remote: data.remote ?? false,
    salaryMin: data.salaryMin ?? null,
    salaryMax: data.salaryMax ?? null,
    rating: data.rating ?? null,
    jobUrl: data.jobUrl ?? null,
    resumeId: data.resumeId ?? null,
    companySize: data.companySize ?? null,
    salaryBandMentioned: data.salaryBandMentioned ?? false,
    triageQuality: data.triageQuality ?? null,
    triageReason: data.triageReason ?? null,
    incomingSource: data.incomingSource ?? null,
    autoRejected: data.autoRejected ?? false,
    autoRejectReason: data.autoRejectReason ?? null,
    archivedAt: toDate(data.archivedAt) ?? null,
    createdAt: toDate(data.createdAt) ?? new Date(),
    updatedAt: toDate(data.updatedAt) ?? new Date(),
    contacts: data._contacts, // populated separately when needed
  };
}

function mapContact(id: string, data: FirebaseFirestore.DocumentData): ContactRecord {
  return {
    id,
    name: data.name,
    email: data.email ?? null,
    phone: data.phone ?? null,
    role: data.role ?? null,
    linkedIn: data.linkedIn ?? null,
    applicationId: data.applicationId,
    createdAt: toDate(data.createdAt) ?? new Date(),
  };
}

function mapDoc(id: string, data: FirebaseFirestore.DocumentData): DocumentRecord {
  return {
    id,
    userId: data.userId,
    filename: data.filename,
    originalName: data.originalName,
    size: data.size,
    mimeType: data.mimeType,
    uploadedAt: toDate(data.uploadedAt) ?? new Date(),
    applications: data._applications, // populated separately when needed
  };
}

// ── Implementation ──────────────────────────────────────────────────────────

export class FirestoreAdapter implements DatabaseAdapter {
  private get db() { return getDb(); }
  private get apps() { return this.db.collection("applications"); }
  private get contacts() { return this.db.collection("contacts"); }
  private get docs() { return this.db.collection("documents"); }

  // ── Applications ────────────────────────────────────────────────────────

  async listApplications(userId: string | null): Promise<ApplicationRecord[]> {
    let q: FirebaseFirestore.Query = this.apps.orderBy("createdAt", "desc");
    if (userId) q = q.where("userId", "==", userId);
    const snap = await q.get();
    const applications = snap.docs.map((d) => mapApp(d.id, d.data()));

    // Batch-load contacts for all applications
    const appIds = applications.map((a) => a.id);
    if (appIds.length > 0) {
      const contactsByApp = await this.loadContactsByAppIds(appIds);
      for (const app of applications) {
        app.contacts = contactsByApp.get(app.id) ?? [];
      }
    }
    return applications;
  }

  async listApplicationsPaginated(
    userId: string | null,
    params: PaginationParams
  ): Promise<PaginatedResult<ApplicationRecord>> {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.max(1, Math.min(100, params.pageSize ?? 10));

    // Firestore doesn't support count + offset natively, so we fetch all IDs
    let q: FirebaseFirestore.Query = this.apps.orderBy("createdAt", "desc");
    if (userId) q = q.where("userId", "==", userId);

    const snap = await q.get();
    const total = snap.docs.length;
    const totalPages = Math.ceil(total / pageSize);

    const start = (page - 1) * pageSize;
    const pageDocs = snap.docs.slice(start, start + pageSize);
    const applications = pageDocs.map((d) => mapApp(d.id, d.data()));

    // Batch-load contacts for the page
    const appIds = applications.map((a) => a.id);
    if (appIds.length > 0) {
      const contactsByApp = await this.loadContactsByAppIds(appIds);
      for (const app of applications) {
        app.contacts = contactsByApp.get(app.id) ?? [];
      }
    }

    return { data: applications, total, page, pageSize, totalPages };
  }

  async getApplication(id: string, userId: string | null): Promise<ApplicationRecord | null> {
    const doc = await this.apps.doc(id).get();
    if (!doc.exists) return null;
    const data = doc.data()!;
    if (userId && data.userId !== userId) return null;

    const app = mapApp(id, data);
    // Load contacts
    const contactSnap = await this.contacts.where("applicationId", "==", id).get();
    app.contacts = contactSnap.docs.map((d) => mapContact(d.id, d.data()));
    return app;
  }

  async createApplication(userId: string, data: CreateApplicationInput): Promise<ApplicationRecord> {
    const now = Timestamp.now();
    const ref = await this.apps.add({
      userId,
      company: data.company,
      role: data.role,
      status: normalizeStatus(data.status),
      appliedAt: toTimestamp(data.appliedAt),
      lastContact: toTimestamp(data.lastContact),
      followUpAt: toTimestamp(data.followUpAt),
      notes: data.notes,
      jobDescription: data.jobDescription,
      remote: data.remote ?? false,
      salaryMin: data.salaryMin ?? null,
      salaryMax: data.salaryMax ?? null,
      rating: data.rating ?? null,
      jobUrl: data.jobUrl ?? null,
      companySize: data.companySize ?? null,
      salaryBandMentioned: data.salaryBandMentioned ?? false,
      triageQuality: data.triageQuality ?? null,
      triageReason: data.triageReason ?? null,
      incomingSource: data.incomingSource ?? null,
      autoRejected: data.autoRejected ?? false,
      autoRejectReason: data.autoRejectReason ?? null,
      createdAt: now,
      updatedAt: now,
    });
    const snap = await ref.get();
    const app = mapApp(ref.id, snap.data()!);
    app.contacts = [];
    return app;
  }

  async updateApplication(id: string, userId: string, data: UpdateApplicationInput): Promise<ApplicationRecord> {
    const ref = this.apps.doc(id);
    const existing = await ref.get();
    if (!existing.exists || existing.data()!.userId !== userId) {
      throw new Error("Not found");
    }

    const update: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
    if (data.company !== undefined) update.company = data.company;
    if (data.role !== undefined) update.role = data.role;
    if (data.status !== undefined) update.status = normalizeStatus(data.status);
    if (data.appliedAt !== undefined) update.appliedAt = toTimestamp(data.appliedAt);
    if (data.lastContact !== undefined) update.lastContact = toTimestamp(data.lastContact);
    if (data.followUpAt !== undefined) update.followUpAt = toTimestamp(data.followUpAt);
    if (data.notes !== undefined) update.notes = data.notes;
    if (data.jobDescription !== undefined) update.jobDescription = data.jobDescription;
    if (data.remote !== undefined) update.remote = data.remote;
    if (data.salaryMin !== undefined) update.salaryMin = data.salaryMin;
    if (data.salaryMax !== undefined) update.salaryMax = data.salaryMax;
    if (data.rating !== undefined) update.rating = data.rating;
    if (data.jobUrl !== undefined) update.jobUrl = data.jobUrl;
    if (data.companySize !== undefined) update.companySize = data.companySize;
    if (data.salaryBandMentioned !== undefined) update.salaryBandMentioned = data.salaryBandMentioned;
    if (data.triageQuality !== undefined) update.triageQuality = data.triageQuality;
    if (data.triageReason !== undefined) update.triageReason = data.triageReason;
    if (data.incomingSource !== undefined) update.incomingSource = data.incomingSource;
    if (data.autoRejected !== undefined) update.autoRejected = data.autoRejected;
    if (data.autoRejectReason !== undefined) update.autoRejectReason = data.autoRejectReason;

    await ref.update(update);
    return (await this.getApplication(id, userId))!;
  }

  async deleteApplication(id: string, userId: string): Promise<void> {
    const ref = this.apps.doc(id);
    const existing = await ref.get();
    if (!existing.exists || existing.data()!.userId !== userId) {
      throw new Error("Not found");
    }
    // Cascade: delete contacts
    const contactSnap = await this.contacts.where("applicationId", "==", id).get();
    const batch = this.db.batch();
    contactSnap.docs.forEach((d) => batch.delete(d.ref));
    batch.delete(ref);
    await batch.commit();
  }

  async listApplicationsFiltered(
    userId: string | null,
    filter: ListApplicationsFilter
  ): Promise<Partial<ApplicationRecord>[]> {
    // Firestore has limited query capabilities, so we fetch and filter in memory
    let q: FirebaseFirestore.Query = this.apps.orderBy("createdAt", "desc");
    if (userId) q = q.where("userId", "==", userId);
    if (filter.status?.length === 1) {
      q = q.where("status", "==", filter.status[0]);
    }
    if (filter.remote !== undefined) {
      q = q.where("remote", "==", filter.remote);
    }

    const snap = await q.get();
    let apps = snap.docs.map((d) => mapApp(d.id, d.data()));

    // In-memory filters for capabilities Firestore doesn't support natively
    if (filter.status && filter.status.length > 1) {
      const statusSet = new Set(filter.status);
      apps = apps.filter((a) => statusSet.has(a.status));
    }
    if (filter.ratingGte !== undefined) {
      apps = apps.filter((a) => a.rating !== null && a.rating >= filter.ratingGte!);
    }
    if (filter.triageQualityGte !== undefined) {
      apps = apps.filter((a) => a.triageQuality !== null && a.triageQuality >= filter.triageQualityGte!);
    }
    if (filter.search) {
      const term = filter.search.toLowerCase();
      apps = apps.filter(
        (a) =>
          a.company.toLowerCase().includes(term) ||
          a.role.toLowerCase().includes(term) ||
          (a.notes?.toLowerCase().includes(term) ?? false) ||
          (a.jobDescription?.toLowerCase().includes(term) ?? false)
      );
    }

    // Sort
    if (filter.sort) {
      const desc = filter.sort.startsWith("-");
      const field = desc ? filter.sort.slice(1) : filter.sort;
      const allowedSortFields = [
        "createdAt", "updatedAt", "company", "role", "status",
        "rating", "salaryMin", "salaryMax", "appliedAt", "lastContact",
        "triageQuality",
      ];
      if (allowedSortFields.includes(field)) {
        apps.sort((a, b) => {
          const av = a[field as keyof ApplicationRecord];
          const bv = b[field as keyof ApplicationRecord];
          if (av == null && bv == null) return 0;
          if (av == null) return 1;
          if (bv == null) return -1;
          const cmp = av < bv ? -1 : av > bv ? 1 : 0;
          return desc ? -cmp : cmp;
        });
      }
    }

    // Limit
    if (filter.limit) {
      apps = apps.slice(0, filter.limit);
    }

    // Load contacts if requested
    if (filter.includeContacts) {
      const appIds = apps.map((a) => a.id);
      if (appIds.length > 0) {
        const contactsByApp = await this.loadContactsByAppIds(appIds);
        for (const app of apps) {
          app.contacts = contactsByApp.get(app.id) ?? [];
        }
      }
    }

    // Field selection
    const fields = filter.fields;
    if (fields?.length) {
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

    return apps;
  }

  async batchUpsertApplications(userId: string, items: BatchUpsertItem[]): Promise<BatchUpsertResult> {
    const results: BatchUpsertResult["results"] = [];
    let succeeded = 0;
    let failed = 0;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      try {
        if (item.id) {
          // Update
          const ref = this.apps.doc(item.id);
          const existing = await ref.get();
          if (!existing.exists || existing.data()!.userId !== userId) {
            results.push({ index: i, id: item.id, operation: "updated", error: "Not found or access denied" });
            failed++;
            continue;
          }
          const update: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
          if (item.company !== undefined) update.company = item.company;
          if (item.role !== undefined) update.role = item.role;
          if (item.status !== undefined) update.status = normalizeStatus(item.status);
          if (item.appliedAt !== undefined) update.appliedAt = toTimestamp(item.appliedAt);
          if (item.lastContact !== undefined) update.lastContact = toTimestamp(item.lastContact);
          if (item.followUpAt !== undefined) update.followUpAt = toTimestamp(item.followUpAt);
          if (item.notes !== undefined) update.notes = item.notes;
          if (item.jobDescription !== undefined) update.jobDescription = item.jobDescription;
          if (item.source !== undefined) update.source = item.source;
          if (item.remote !== undefined) update.remote = item.remote;
          if (item.salaryMin !== undefined) update.salaryMin = item.salaryMin;
          if (item.salaryMax !== undefined) update.salaryMax = item.salaryMax;
          if (item.rating !== undefined) update.rating = item.rating;
          if (item.jobUrl !== undefined) update.jobUrl = item.jobUrl;
          Object.assign(update, sanitizeTriageFields(item as Record<string, unknown>));

          await ref.update(update);
          results.push({ index: i, id: item.id, operation: "updated" });
          succeeded++;
        } else {
          // Create
          if (!item.company || !item.role) {
            results.push({ index: i, id: "", operation: "created", error: "company and role are required for new applications" });
            failed++;
            continue;
          }
          const now = Timestamp.now();
          const ref = await this.apps.add({
            userId,
            company: item.company,
            role: item.role,
            status: normalizeStatus(item.status || "applied"),
            appliedAt: toTimestamp(item.appliedAt ?? null),
            lastContact: toTimestamp(item.lastContact ?? null),
            followUpAt: toTimestamp(item.followUpAt ?? null),
            notes: item.notes ?? null,
            jobDescription: item.jobDescription ?? null,
            source: item.source ?? null,
            remote: item.remote ?? false,
            salaryMin: item.salaryMin ?? null,
            salaryMax: item.salaryMax ?? null,
            rating: item.rating ?? null,
            jobUrl: item.jobUrl ?? null,
            ...sanitizeTriageFields({
              companySize: item.companySize ?? null,
              salaryBandMentioned: item.salaryBandMentioned ?? false,
              triageQuality: item.triageQuality ?? null,
              triageReason: item.triageReason ?? null,
              incomingSource: item.incomingSource ?? null,
              autoRejected: item.autoRejected ?? false,
              autoRejectReason: item.autoRejectReason ?? null,
            }),
            createdAt: now,
            updatedAt: now,
          });
          results.push({ index: i, id: ref.id, operation: "created" });
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

    // Verify ownership and collect refs for batch delete
    const toDelete: { id: string; ref: FirebaseFirestore.DocumentReference }[] = [];
    for (const id of ids) {
      const ref = this.apps.doc(id);
      const existing = await ref.get();
      if (!existing.exists || existing.data()!.userId !== userId) {
        results.push({ id, deleted: false, error: "Not found or access denied" });
        failed++;
      } else {
        toDelete.push({ id, ref });
      }
    }

    if (toDelete.length > 0) {
      // Collect associated contacts for cascade delete
      const appIds = toDelete.map((d) => d.id);
      const contactRefs: FirebaseFirestore.DocumentReference[] = [];
      for (let i = 0; i < appIds.length; i += 30) {
        const chunk = appIds.slice(i, i + 30);
        const contactSnap = await this.contacts.where("applicationId", "in", chunk).get();
        contactSnap.docs.forEach((d) => contactRefs.push(d.ref));
      }

      // Firestore batches have a 500 operation limit; chunk if needed
      const allRefs = [
        ...contactRefs,
        ...toDelete.map(({ ref }) => ref),
      ];
      for (let i = 0; i < allRefs.length; i += 499) {
        const chunk = allRefs.slice(i, i + 499);
        const batch = this.db.batch();
        chunk.forEach((ref) => batch.delete(ref));
        await batch.commit();
      }

      for (const { id } of toDelete) {
        results.push({ id, deleted: true });
        succeeded++;
      }
    }

    return { total: ids.length, succeeded, failed, results };
  }

  // ── Contacts ────────────────────────────────────────────────────────────

  async verifyApplicationOwner(id: string, userId: string): Promise<boolean> {
    const doc = await this.apps.doc(id).get();
    return doc.exists && doc.data()!.userId === userId;
  }

  async createContact(applicationId: string, data: CreateContactInput): Promise<ContactRecord> {
    const ref = await this.contacts.add({
      applicationId,
      name: data.name,
      email: data.email,
      phone: data.phone,
      role: data.role,
      linkedIn: data.linkedIn,
      createdAt: Timestamp.now(),
    });
    const snap = await ref.get();
    return mapContact(ref.id, snap.data()!);
  }

  async updateContact(id: string, applicationId: string, userId: string, data: UpdateContactInput): Promise<ContactRecord> {
    // Verify ownership chain
    if (!(await this.verifyApplicationOwner(applicationId, userId))) {
      throw new Error("Not found");
    }
    const ref = this.contacts.doc(id);
    const existing = await ref.get();
    if (!existing.exists || existing.data()!.applicationId !== applicationId) {
      throw new Error("Not found");
    }
    const update: Record<string, unknown> = {};
    if (data.name !== undefined) update.name = data.name;
    if (data.email !== undefined) update.email = data.email;
    if (data.phone !== undefined) update.phone = data.phone;
    if (data.role !== undefined) update.role = data.role;
    if (data.linkedIn !== undefined) update.linkedIn = data.linkedIn;

    await ref.update(update);
    const snap = await ref.get();
    return mapContact(id, snap.data()!);
  }

  async deleteContact(id: string, applicationId: string, userId: string): Promise<void> {
    if (!(await this.verifyApplicationOwner(applicationId, userId))) {
      throw new Error("Not found");
    }
    const ref = this.contacts.doc(id);
    const existing = await ref.get();
    if (!existing.exists || existing.data()!.applicationId !== applicationId) {
      throw new Error("Not found");
    }
    await ref.delete();
  }

  // ── Documents ───────────────────────────────────────────────────────────

  async listDocumentsByApplication(applicationId: string, userId: string): Promise<DocumentRecord[]> {
    const all = await this.listDocuments(userId);
    return all.filter((d) => d.applications?.some((a) => a.id === applicationId));
  }

  async listDocuments(userId: string | null): Promise<DocumentRecord[]> {
    let q: FirebaseFirestore.Query = this.docs.orderBy("uploadedAt", "desc");
    if (userId) q = q.where("userId", "==", userId);
    const snap = await q.get();
    const documents = snap.docs.map((d) => {
      const rec = mapDoc(d.id, d.data());
      rec.applications = []; // populated below
      return rec;
    });

    // Batch-resolve application refs
    const allAppIds = new Set<string>();
    snap.docs.forEach((d) => {
      const ids: string[] = d.data().applicationIds ?? [];
      ids.forEach((id) => allAppIds.add(id));
    });

    if (allAppIds.size > 0) {
      const appMap = await this.loadAppRefs([...allAppIds]);
      for (let i = 0; i < documents.length; i++) {
        const ids: string[] = snap.docs[i].data().applicationIds ?? [];
        documents[i].applications = ids
          .map((id) => appMap.get(id))
          .filter((a): a is NonNullable<typeof a> => !!a);
      }
    }
    return documents;
  }

  async getDocument(id: string, userId: string | null): Promise<DocumentRecord | null> {
    const doc = await this.docs.doc(id).get();
    if (!doc.exists) return null;
    const data = doc.data()!;
    if (userId && data.userId !== userId) return null;
    return mapDoc(id, data);
  }

  async createDocument(userId: string, data: CreateDocumentInput): Promise<DocumentRecord> {
    const { applicationIds, ...rest } = data;

    // Verify ownership of referenced applications and load refs in one batch
    let appMap = new Map<string, { id: string; company: string; role: string }>();
    if (applicationIds.length > 0) {
      appMap = await this.loadVerifiedAppRefs(applicationIds, userId);
    }
    const safeIds = Array.from(appMap.keys());

    const ref = await this.docs.add({
      userId,
      ...rest,
      applicationIds: safeIds,
      uploadedAt: Timestamp.now(),
    });
    const snap = await ref.get();
    const rec = mapDoc(ref.id, snap.data()!);

    // Populate resolved app refs
    rec.applications = safeIds
      .map((id) => appMap.get(id))
      .filter((a): a is NonNullable<typeof a> => !!a);

    return rec;
  }

  async updateDocumentLinks(id: string, userId: string, applicationIds: string[]): Promise<DocumentRecord> {
    const ref = this.docs.doc(id);
    const existing = await ref.get();
    if (!existing.exists || existing.data()!.userId !== userId) {
      throw new Error("Not found");
    }

    // Verify ownership of referenced applications and load refs in one batch
    let appMap = new Map<string, { id: string; company: string; role: string }>();
    if (applicationIds.length > 0) {
      appMap = await this.loadVerifiedAppRefs(applicationIds, userId);
    }
    const safeIds = Array.from(appMap.keys());
    await ref.update({ applicationIds: safeIds });

    const rec = mapDoc(id, (await ref.get()).data()!);
    // Populate resolved app refs
    rec.applications = safeIds
      .map((aid) => appMap.get(aid))
      .filter((a): a is NonNullable<typeof a> => !!a);
    return rec;
  }

  async renameDocument(id: string, userId: string, newName: string): Promise<DocumentRecord | null> {
    const ref = this.docs.doc(id);
    const existing = await ref.get();
    if (!existing.exists || existing.data()!.userId !== userId) return null;
    await ref.update({ originalName: newName });
    const updated = await ref.get();
    const data = updated.data()!;
    const rec = mapDoc(id, data);
    const appIds: string[] = data.applicationIds ?? [];

    // Verify ownership of referenced applications and load refs in one batch
    let appMap = new Map<string, { id: string; company: string; role: string }>();
    if (appIds.length > 0) {
      appMap = await this.loadVerifiedAppRefs(appIds, userId);
    }
    rec.applications = appIds
      .map((aid) => appMap.get(aid))
      .filter((a): a is NonNullable<typeof a> => !!a);

    return rec;
  }

  async deleteDocument(id: string, userId: string): Promise<DocumentRecord | null> {
    const ref = this.docs.doc(id);
    const existing = await ref.get();
    if (!existing.exists || existing.data()!.userId !== userId) return null;
    const rec = mapDoc(id, existing.data()!);
    await prisma.shareLink.deleteMany({ where: { userId, targetType: "document", targetId: id } });
    await ref.delete();
    return rec;
  }

  // ── Users ───────────────────────────────────────────────────────────────
  // Auth data lives in Prisma (PostgreSQL) for both backends.

  async getUser(id: string): Promise<UserRecord | null> {
    return prisma.user.findUnique({
      where: { id },
      select: { id: true, name: true, email: true, isAdmin: true },
    });
  }

  async listUsers(): Promise<UserRecord[]> {
    return prisma.user.findMany({
      orderBy: [{ isAdmin: "desc" }, { email: "asc" }],
      select: { id: true, name: true, email: true, isAdmin: true },
    });
  }

  async updateUserAdmin(id: string, isAdmin: boolean): Promise<UserRecord> {
    return prisma.$transaction(async (tx) => {
      // If we are trying to demote an admin, ensure at least one admin remains
      if (!isAdmin) {
        const target = await tx.user.findUnique({
          where: { id },
          select: { isAdmin: true },
        });

        if (target?.isAdmin) {
          const adminCount = await tx.user.count({
            where: { isAdmin: true },
          });

          if (adminCount <= 1) {
            throw new Error("AT_LEAST_ONE_ADMIN_REQUIRED");
          }
        }
      }

      return tx.user.update({
        where: { id },
        data: { isAdmin },
        select: { id: true, name: true, email: true, isAdmin: true },
      });
    }, {
      isolationLevel: "Serializable",
    });
  }

  // ── Audit Logs (stored in Prisma like users) ──────────────────────────

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
      id: String(r.id),
      actorId: r.actorId,
      actorEmail: r.actor.email,
      action: r.action,
      targetId: r.targetId,
      targetEmail: r.target.email,
      createdAt: r.createdAt,
    }));
  }

  // ── API Tokens (stored in Prisma like users) ──────────────────────────

  async getApiTokenByHash(tokenHash: string): Promise<ApiTokenRecord | null> {
    const row = await prisma.userApiToken.findUnique({ where: { tokenHash } });
    return row ? { ...row, id: String(row.id) } : null;
  }

  async getApiToken(userId: string): Promise<ApiTokenInfo | null> {
    const row = await prisma.userApiToken.findFirst({
      where: { userId },
      select: { id: true, name: true, createdAt: true, lastUsedAt: true },
    });
    return row ? { ...row, id: String(row.id) } : null;
  }

  async createApiToken(userId: string, tokenHash: string, name = "default"): Promise<ApiTokenInfo> {
    await prisma.userApiToken.deleteMany({ where: { userId } });
    const row = await prisma.userApiToken.create({
      data: { userId, tokenHash, name },
      select: { id: true, name: true, createdAt: true, lastUsedAt: true },
    });
    return { ...row, id: String(row.id) };
  }

  async deleteApiToken(userId: string): Promise<void> {
    await prisma.userApiToken.deleteMany({ where: { userId } });
  }

  async touchApiTokenLastUsed(id: string): Promise<void> {
    await prisma.userApiToken.update({
      where: { id: parseInt(id, 10) },
      data: { lastUsedAt: new Date() },
    });
  }

  // ── Share Links (stored in Prisma like users) ─────────────────────────

  async getShareLinkByCode(code: string): Promise<ShareLinkRecord | null> {
    const row = await prisma.shareLink.findUnique({ where: { code } });
    return row ? { ...row, id: String(row.id) } : null;
  }

  async findShareLink(userId: string, targetType: string, targetId: string | null): Promise<ShareLinkRecord | null> {
    const row = await prisma.shareLink.findFirst({
      where: { userId, targetType, targetId },
    });
    return row ? { ...row, id: String(row.id) } : null;
  }

  async createShareLink(userId: string, data: CreateShareLinkInput): Promise<ShareLinkRecord> {
    const row = await prisma.shareLink.create({
      data: { userId, ...data },
    });
    return { ...row, id: String(row.id) };
  }

  async deleteShareLink(id: string, userId: string): Promise<void> {
    await prisma.shareLink.delete({ where: { id: parseInt(id, 10), userId } });
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  private async loadContactsByAppIds(appIds: string[]): Promise<Map<string, ContactRecord[]>> {
    const map = new Map<string, ContactRecord[]>();
    // Firestore `in` queries support max 30 values; chunk if needed
    for (let i = 0; i < appIds.length; i += 30) {
      const chunk = appIds.slice(i, i + 30);
      const snap = await this.contacts.where("applicationId", "in", chunk).get();
      for (const doc of snap.docs) {
        const c = mapContact(doc.id, doc.data());
        const list = map.get(c.applicationId) ?? [];
        list.push(c);
        map.set(c.applicationId, list);
      }
    }
    return map;
  }

  private async loadAppRefs(ids: string[]): Promise<Map<string, { id: string; company: string; role: string }>> {
    const map = new Map<string, { id: string; company: string; role: string }>();
    for (let i = 0; i < ids.length; i += 30) {
      const chunk = ids.slice(i, i + 30);
      const refs = chunk.map((id) => this.apps.doc(id));
      const snaps = await this.db.getAll(...refs);
      for (const snap of snaps) {
        if (snap.exists) {
          const d = snap.data()!;
          map.set(snap.id, { id: snap.id, company: d.company, role: d.role });
        }
      }
    }
    return map;
  }

  private async loadVerifiedAppRefs(
    ids: string[],
    userId: string,
  ): Promise<Map<string, { id: string; company: string; role: string }>> {
    const map = new Map<string, { id: string; company: string; role: string }>();
    for (let i = 0; i < ids.length; i += 30) {
      const chunk = ids.slice(i, i + 30);
      const refs = chunk.map((id) => this.apps.doc(id));
      const snaps = await this.db.getAll(...refs);
      for (const snap of snaps) {
        if (snap.exists) {
          const d = snap.data()!;
          if (d.userId === userId) {
            map.set(snap.id, { id: snap.id, company: d.company, role: d.role });
          }
        }
      }
    }
    return map;
  }

  // CV — Always uses Prisma/PostgreSQL. CvPatch has integer foreign keys to
  // Application, which is incompatible with Firestore's string document IDs.
  // CvProfile is userId-keyed and works fine. CvPatch methods will fail if
  // applications live in Firestore (applicationId would not be numeric).

  async getCvProfile(userId: string): Promise<CvProfileRecord | null> {
    const row = await prisma.cvProfile.findUnique({ where: { userId } });
    if (!row) return null;
    return {
      id: String(row.id),
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

  async upsertCvProfile(userId: string, data: UpsertCvProfileInput): Promise<CvProfileRecord> {
    const payload = {
      name: data.name,
      contact: data.contact as unknown as import("@prisma/client").Prisma.InputJsonValue,
      profile: data.profile,
      skills: data.skills as unknown as import("@prisma/client").Prisma.InputJsonValue,
      experience: data.experience as unknown as import("@prisma/client").Prisma.InputJsonValue,
      projects: (data.projects ?? []) as unknown as import("@prisma/client").Prisma.InputJsonValue,
      education: (data.education ?? []) as unknown as import("@prisma/client").Prisma.InputJsonValue,
    };
    const row = await prisma.cvProfile.upsert({
      where: { userId },
      create: { userId, ...payload },
      update: payload,
    });
    return {
      id: String(row.id),
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

  async getCvPatch(applicationId: string, userId: string): Promise<CvPatchRecord | null> {
    const row = await prisma.cvPatch.findFirst({
      where: { applicationId: parseInt(applicationId, 10), application: { userId } },
    });
    if (!row) return null;
    return {
      id: String(row.id),
      applicationId: String(row.applicationId),
      profileOverride: row.profileOverride,
      experienceIds: row.experienceIds as string[],
      skillCategories: row.skillCategories as string[],
      includeProjects: row.includeProjects,
      includeEducation: row.includeEducation,
      documentId: row.documentId ? String(row.documentId) : null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async upsertCvPatch(applicationId: string, data: UpsertCvPatchInput): Promise<CvPatchRecord> {
    const appId = parseInt(applicationId, 10);
    const payload = {
      profileOverride: data.profileOverride ?? null,
      experienceIds: data.experienceIds as unknown as import("@prisma/client").Prisma.InputJsonValue,
      skillCategories: data.skillCategories as unknown as import("@prisma/client").Prisma.InputJsonValue,
      includeProjects: data.includeProjects ?? false,
      includeEducation: data.includeEducation ?? true,
    };
    const row = await prisma.cvPatch.upsert({
      where: { applicationId: appId },
      create: { applicationId: appId, ...payload },
      update: payload,
    });
    return {
      id: String(row.id),
      applicationId: String(row.applicationId),
      profileOverride: row.profileOverride,
      experienceIds: row.experienceIds as string[],
      skillCategories: row.skillCategories as string[],
      includeProjects: row.includeProjects,
      includeEducation: row.includeEducation,
      documentId: row.documentId ? String(row.documentId) : null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async setCvPatchDocumentId(patchId: string, documentId: string | null): Promise<void> {
    await prisma.cvPatch.update({
      where: { id: parseInt(patchId, 10) },
      data: { documentId: documentId ? parseInt(documentId, 10) : null },
    });
  }
}
