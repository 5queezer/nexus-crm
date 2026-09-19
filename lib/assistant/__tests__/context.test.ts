import { describe, expect, it } from "vitest";
import {
	assistantContextSchema,
	mergeAssistantContext,
	DEFAULT_ASSISTANT_CONTEXT,
} from "../context";

describe("assistant page context", () => {
	it("keeps only bounded, non-secret application context", () => {
		const parsed = assistantContextSchema.parse({
			route: "/opportunities",
			activeRecordId: "application-1",
			filters: { query: "platform", statuses: ["applied"] },
			visibleIds: ["application-1", "application-2"],
			visibleCount: 2,
			selectedIds: ["application-2"],
			dirtyEditorIds: ["brief"],
			capabilities: ["open_record", "set_filters"],
			taskIds: ["task-1"],
			taskProgress: [{ taskId: "task-1", status: "running", completed: 2, total: 5 }],
		});

		expect(parsed).not.toHaveProperty("credentials");
		expect(parsed.selectedIds).toEqual(["application-2"]);
	});

	it("merges page updates without silently changing an existing selection", () => {
		const selected = mergeAssistantContext(DEFAULT_ASSISTANT_CONTEXT, {
			selectedIds: ["application-1"],
			visibleIds: ["application-1"],
			visibleCount: 1,
		});
		const filtered = mergeAssistantContext(selected, {
			filters: { query: "new filter" },
			visibleIds: ["application-2"],
			visibleCount: 1,
		});

		expect(filtered.selectedIds).toEqual(["application-1"]);
		expect(filtered.visibleIds).toEqual(["application-2"]);
	});

	it("clears page-scoped state when navigation changes the route", () => {
		const dashboard = mergeAssistantContext(DEFAULT_ASSISTANT_CONTEXT, {
			route: "/",
			timeZone: "Europe/Madrid",
			filters: { statuses: ["applied"] },
			visibleIds: ["application-1"],
			visibleCount: 1,
			selectedIds: ["application-1"],
			taskIds: ["task-1"],
		});
		const detail = mergeAssistantContext(dashboard, {
			route: "/applications/application-2",
			activeRecordId: "application-2",
		});
		expect(detail.filters).toEqual({});
		expect(detail.selectedIds).toEqual([]);
		expect(detail.visibleIds).toEqual([]);
		expect(detail.taskIds).toEqual(["task-1"]);
		expect(detail.timeZone).toBe("Europe/Madrid");
	});
});
