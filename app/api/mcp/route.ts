import { NextRequest } from "next/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod/v3";
import { getDb } from "@/lib/db";
import { hashApiToken } from "@/lib/token";
import { prisma } from "@/lib/prisma";
import { normalizeStatus } from "@/types";
import { verifyMcpAccessToken } from "@/lib/mcp-oauth";
import { generateAndStoreCv } from "@/lib/cv/generate";
import type { SessionAuthResult, SessionUser } from "@/lib/session";
import type { UpsertCvProfileInput } from "@/lib/db/types";

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
        .describe("Application status (default: applied)"),
      appliedAt: z
        .string()
        .optional()
        .describe("Date applied (ISO 8601)"),
      notes: z.string().optional().describe("Free-text notes"),
      jobDescription: z
        .string()
        .optional()
        .describe("Job description text"),
      source: z.string().optional().describe("Source (linkedin, referral, etc.)"),
      remote: z.boolean().optional().describe("Remote position?"),
      salaryMin: z.number().optional().describe("Minimum salary"),
      salaryMax: z.number().optional().describe("Maximum salary"),
      jobUrl: z.string().optional().describe("URL to job listing or opportunity page"),
      resumeId: z.string().nullable().optional().describe("Reactive Resume resume ID"),
    },
    async (args) => {
      const app = await getDb().createApplication(auth.userId, {
        company: args.company.slice(0, 255),
        role: args.role.slice(0, 255),
        status: normalizeStatus(args.status || "applied"),
        appliedAt: args.appliedAt ? new Date(args.appliedAt) : null,
        lastContact: null,
        followUpAt: null,
        notes: args.notes?.slice(0, 10000) ?? null,
        jobDescription: args.jobDescription?.slice(0, 50000) ?? null,
        source: args.source?.slice(0, 100) ?? null,
        remote: args.remote ?? false,
        salaryMin: args.salaryMin ?? null,
        salaryMax: args.salaryMax ?? null,
        rating: null,
        jobUrl: args.jobUrl?.slice(0, 2000) ?? null,
        resumeId: args.resumeId ?? null,
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
    },
    async ({ id, ...data }) => {
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

      try {
        const app = await getDb().updateApplication(id, auth.userId, update);
        return {
          content: [{ type: "text", text: JSON.stringify(app, null, 2) }],
        };
      } catch {
        return {
          content: [{ type: "text", text: "Application not found or access denied" }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "delete_application",
    "Delete an application and its contacts",
    { id: z.string().describe("Application ID") },
    async ({ id }) => {
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
      const contact = await getDb().createContact(applicationId, {
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
    "List all uploaded documents",
    {},
    async () => {
      const docs = await getDb().listDocuments(auth.readScopeUserId);
      return {
        content: [{ type: "text", text: JSON.stringify(docs, null, 2) }],
      };
    }
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
      return {
        content: [{ type: "text", text: JSON.stringify(doc, null, 2) }],
      };
    }
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
        const doc = await getDb().updateDocumentLinks(id, auth.userId, applicationIds);
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
    "delete_document",
    "Delete a document",
    { id: z.string().describe("Document ID") },
    async ({ id }) => {
      try {
        const result = await getDb().deleteDocument(id, auth.userId);
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
    return new Response(JSON.stringify({ error: "Unauthorized – provide Bearer token" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
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
