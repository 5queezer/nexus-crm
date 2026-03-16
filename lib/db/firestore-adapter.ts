import { getFirestore, Timestamp, FieldValue } from "firebase-admin/firestore";
import { getApps, initializeApp, applicationDefault } from "firebase-admin/app";
import { prisma } from "@/lib/prisma";
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
    resumeId: data.resumeId ?? null,
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

    // Verify ownership of referenced applications
    let safeIds: string[] = [];
    if (applicationIds.length > 0) {
      const checks = await Promise.all(
        applicationIds.map(async (id) => {
          const doc = await this.apps.doc(id).get();
          return doc.exists && doc.data()!.userId === userId ? id : null;
        }),
      );
      safeIds = checks.filter((id): id is string => !!id);
    }

    const ref = await this.docs.add({
      userId,
      ...rest,
      applicationIds: safeIds,
      uploadedAt: Timestamp.now(),
    });
    const snap = await ref.get();
    const rec = mapDoc(ref.id, snap.data()!);

    // Resolve app refs
    if (safeIds.length > 0) {
      const appMap = await this.loadAppRefs(safeIds);
      rec.applications = safeIds.map((id) => appMap.get(id)).filter((a): a is NonNullable<typeof a> => !!a);
    } else {
      rec.applications = [];
    }
    return rec;
  }

  async updateDocumentLinks(id: string, userId: string, applicationIds: string[]): Promise<DocumentRecord> {
    const ref = this.docs.doc(id);
    const existing = await ref.get();
    if (!existing.exists || existing.data()!.userId !== userId) {
      throw new Error("Not found");
    }

    // Verify ownership
    const checks = await Promise.all(
      applicationIds.map(async (aid) => {
        const doc = await this.apps.doc(aid).get();
        return doc.exists && doc.data()!.userId === userId ? aid : null;
      }),
    );
    const safeIds = checks.filter((id): id is string => !!id);
    await ref.update({ applicationIds: safeIds });

    const rec = mapDoc(id, (await ref.get()).data()!);
    if (safeIds.length > 0) {
      const appMap = await this.loadAppRefs(safeIds);
      rec.applications = safeIds.map((id) => appMap.get(id)).filter((a): a is NonNullable<typeof a> => !!a);
    } else {
      rec.applications = [];
    }
    return rec;
  }

  async renameDocument(id: string, userId: string, newName: string): Promise<DocumentRecord | null> {
    const ref = this.docs.doc(id);
    const existing = await ref.get();
    if (!existing.exists || existing.data()!.userId !== userId) return null;
    await ref.update({ originalName: newName });
    const updated = await ref.get();
    const rec = mapDoc(id, updated.data()!);
    const appIds: string[] = updated.data()!.applicationIds ?? [];
    if (appIds.length > 0) {
      const appMap = await this.loadAppRefs(appIds);
      rec.applications = appIds.map((aid) => appMap.get(aid)).filter((a): a is NonNullable<typeof a> => !!a);
    } else {
      rec.applications = [];
    }
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
    return prisma.user.update({
      where: { id },
      data: { isAdmin },
      select: { id: true, name: true, email: true, isAdmin: true },
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
}
