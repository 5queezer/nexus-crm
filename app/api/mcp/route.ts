import { NextRequest } from "next/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod/v3";
import { getDb } from "@/lib/db";
import { hashApiToken } from "@/lib/token";
import { prisma } from "@/lib/prisma";
import { normalizeStatus } from "@/types";
import type { SessionAuthResult, SessionUser } from "@/lib/session";

// ── Auth helper (standalone, avoids next/headers which doesn't work here) ────

async function authenticateFromRequest(
  req: NextRequest
): Promise<SessionAuthResult | null> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const raw = authHeader.slice(7);
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
    "Create a new job application",
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
      });
      return {
        content: [{ type: "text", text: JSON.stringify(app, null, 2) }],
      };
    }
  );

  server.tool(
    "update_application",
    "Update an existing application",
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

  await server.connect(transport);
  const response = await transport.handleRequest(req as unknown as Request);
  return response;
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
