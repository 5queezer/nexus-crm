import { describe, expect, it, vi } from "vitest";
import type { DatabaseAdapter } from "@/lib/db/adapter";
import {
  AGENT_LIMITS,
  buildAgentTools,
	buildBulkAgentTools,
  buildBoundedHistory,
	buildDomainReadTools,
	buildFrontendAgentTools,
  buildMcpProposalAuditInput,
} from "../runtime";
import { AGENT_SYSTEM_PROMPT } from "../system-prompt";

const db = {
  listApplications: vi.fn().mockResolvedValue([]),
  getApplication: vi.fn().mockResolvedValue(null),
  updateApplication: vi.fn(),
} as unknown as DatabaseAdapter;

const proposalRepository = {
  create: vi.fn(),
  findByIdempotencyKey: vi.fn().mockResolvedValue(null),
};

describe("agent runtime policy", () => {
  it("registers tenant-scoped reads and proposal creation, never a direct mutation", () => {
    const tools = buildAgentTools({
      db,
      proposalRepository,
      userId: "user-a",
      threadId: "thread-1",
      runId: "run-1",
    });

    expect(Object.keys(tools).sort()).toEqual([
      "get_application",
      "get_pipeline_summary",
      "propose_application_update",
      "search_applications",
    ]);
    expect(Object.keys(tools).some((name) => name === "update_application")).toBe(false);
  });

	it("exposes only bounded typed frontend capabilities", () => {
		const tools = buildFrontendAgentTools({ userId: "user-a", runId: "run-1" });
		expect(Object.keys(tools).sort()).toEqual([
			"highlight_opportunity_field",
			"navigate_to_page",
			"open_bulk_review",
			"open_opportunity",
			"select_opportunities",
			"set_opportunity_filters",
		]);
		expect(Object.keys(tools)).not.toContain("execute_javascript");
	});

	it("exposes bulk changes only as frozen review previews", () => {
		const tools = buildBulkAgentTools({
			userId: "user-a",
			threadId: "thread-1",
			runId: "run-1",
		});
		expect(Object.keys(tools)).toEqual(["preview_bulk_change"]);
		expect(Object.keys(tools)).not.toContain("execute_bulk_change");
	});

	it("registers bounded owner-scoped document, email, and analytics reads", () => {
		const tools = buildDomainReadTools({ userId: "user-a", runId: "run-1" });
		expect(Object.keys(tools).sort()).toEqual([
			"get_analytics_summary",
			"list_documents",
			"list_email_review",
		]);
	});

	it("exposes the user's calendar timezone to analytics reads", () => {
		const tools = buildDomainReadTools({ userId: "user-a", runId: "run-1" });
		const schema = tools.get_analytics_summary.inputSchema as import("zod").ZodType;
		expect(schema.parse({ start: "2026-09-19", end: "2026-09-19", timeZone: "America/Los_Angeles" }))
			.toMatchObject({ timeZone: "America/Los_Angeles" });
	});

  it("bounds steps, total runtime, and tool runtime", () => {
    expect(AGENT_LIMITS.maxSteps).toBeLessThanOrEqual(8);
    expect(AGENT_LIMITS.totalMs).toBeLessThanOrEqual(90_000);
    expect(AGENT_LIMITS.toolMs).toBeLessThanOrEqual(20_000);
  });

  it("keeps the newest conversation turns within a bounded history budget", () => {
    const messages = Array.from({ length: 40 }, (_, index) => ({
      role: index % 2 === 0 ? "user" : "assistant",
      content: `${index}:` + "x".repeat(4_000),
    }));
    const bounded = buildBoundedHistory(messages, {
      maxMessages: 24,
      maxCharacters: 60_000,
    });

    expect(bounded.length).toBeLessThanOrEqual(24);
    expect(bounded.reduce((total, item) => total + item.content.length, 0)).toBeLessThanOrEqual(60_000);
    expect(bounded.at(-1)?.content.startsWith("39:")).toBe(true);
  });

  it("omits unvalidated MCP arguments and free text from audit input", () => {
    const auditInput = buildMcpProposalAuditInput({
      connectorId: "connector-a",
      toolName: "send_message",
      arguments: { authorization: "Bearer must-not-persist", token: "must-not-persist" },
      reason: "contains must-not-persist",
    });

    expect(auditInput).toEqual({
      connectorId: "connector-a",
      toolName: "send_message",
      argumentsOmitted: true,
    });
    expect(JSON.stringify(auditInput)).not.toContain("must-not-persist");
  });

  it("marks external content as untrusted and forbids self-approval", () => {
    expect(AGENT_SYSTEM_PROMPT).toContain("untrusted data");
    expect(AGENT_SYSTEM_PROMPT).toContain("cannot approve");
    expect(AGENT_SYSTEM_PROMPT).not.toContain("API key");
  });
});
