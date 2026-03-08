import { prisma } from "@/lib/prisma";
import type { DatabaseAdapter } from "./adapter";
import type {
  ApplicationRecord,
  ContactRecord,
  DocumentRecord,
  UserRecord,
  CreateApplicationInput,
  UpdateApplicationInput,
  CreateContactInput,
  UpdateContactInput,
  CreateDocumentInput,
} from "./types";

// ── Helpers: convert Prisma int IDs ↔ string IDs ────────────────────────────

function sid(n: number): string {
  return String(n);
}

function nid(s: string): number {
  return parseInt(s, 10);
}

function mapContact(c: { id: number; name: string; email: string | null; phone: string | null; role: string | null; linkedIn: string | null; applicationId: number; createdAt: Date }): ContactRecord {
  return { ...c, id: sid(c.id), applicationId: sid(c.applicationId) };
}

function mapApp(a: { id: number; userId: string; company: string; role: string; status: string; appliedAt: Date | null; lastContact: Date | null; followUpAt: Date | null; notes: string | null; jobDescription: string | null; createdAt: Date; updatedAt: Date; contacts?: { id: number; name: string; email: string | null; phone: string | null; role: string | null; linkedIn: string | null; applicationId: number; createdAt: Date }[] }): ApplicationRecord {
  return {
    ...a,
    id: sid(a.id),
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

function userWhere(userId: string | null): { userId: string } | object {
  return userId ? { userId } : {};
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

  async getApplication(id: string, userId: string | null): Promise<ApplicationRecord | null> {
    const row = await prisma.application.findFirst({
      where: { id: nid(id), ...userWhere(userId) },
      include: { contacts: true },
    });
    return row ? mapApp(row) : null;
  }

  async createApplication(userId: string, data: CreateApplicationInput): Promise<ApplicationRecord> {
    const row = await prisma.application.create({
      data: { userId, ...data },
      include: { contacts: true },
    });
    return mapApp(row);
  }

  async updateApplication(id: string, userId: string, data: UpdateApplicationInput): Promise<ApplicationRecord> {
    const row = await prisma.application.update({
      where: { id: nid(id), userId },
      data,
      include: { contacts: true },
    });
    return mapApp(row);
  }

  async deleteApplication(id: string, userId: string): Promise<void> {
    await prisma.application.delete({ where: { id: nid(id), userId } });
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

  async deleteDocument(id: string, userId: string): Promise<DocumentRecord | null> {
    const doc = await prisma.document.findFirst({ where: { id: nid(id), userId } });
    if (!doc) return null;
    await prisma.document.delete({ where: { id: nid(id), userId } });
    return mapDoc(doc);
  }

  // Users

  async getUser(id: string): Promise<UserRecord | null> {
    const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true, name: true, email: true },
    });
    return user;
  }
}
