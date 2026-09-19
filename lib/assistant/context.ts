import { z } from "zod";

const boundedId = z.string().trim().min(1).max(100);
const stringList = (maximum: number) => z.array(boundedId).max(maximum);

export const assistantFiltersSchema = z
	.object({
		query: z.string().trim().max(200).optional(),
		statuses: stringList(20).optional(),
		sources: stringList(50).optional(),
		workModes: stringList(20).optional(),
		archived: z.boolean().optional(),
	})
	.strict();

export const assistantCapabilitySchema = z.enum([
	"navigate",
	"set_filters",
	"select_ids",
	"open_record",
	"open_tab",
	"highlight_field",
	"open_review",
]);

export const assistantContextSchema = z
	.object({
		route: z.string().trim().min(1).max(500),
		timeZone: z.string().trim().min(1).max(100).optional(),
		activeRecordId: boundedId.nullable(),
		filters: assistantFiltersSchema,
		visibleIds: stringList(200),
		visibleCount: z.number().int().nonnegative().max(1_000_000),
		selectedIds: stringList(2_000),
		dirtyEditorIds: stringList(50),
		capabilities: z.array(assistantCapabilitySchema).max(20),
		taskIds: stringList(100),
		taskProgress: z
			.array(
				z
					.object({
						taskId: boundedId,
						status: z.string().trim().min(1).max(100),
						completed: z.number().int().nonnegative(),
						total: z.number().int().nonnegative(),
					})
					.strict(),
			)
			.max(100),
	})
	.strict();

export type AssistantContext = z.infer<typeof assistantContextSchema>;
export type AssistantContextUpdate = Partial<AssistantContext> & {
	filters?: Partial<AssistantContext["filters"]>;
};

export const assistantContextUpdateSchema = assistantContextSchema
	.partial()
	.extend({ filters: assistantFiltersSchema.partial().optional() })
	.strict();

export const DEFAULT_ASSISTANT_CONTEXT: AssistantContext = {
	route: "/",
	timeZone: "UTC",
	activeRecordId: null,
	filters: {},
	visibleIds: [],
	visibleCount: 0,
	selectedIds: [],
	dirtyEditorIds: [],
	capabilities: [],
	taskIds: [],
	taskProgress: [],
};

export function mergeAssistantContext(
	current: AssistantContext,
	update: AssistantContextUpdate,
): AssistantContext {
	const routeChanged =
		typeof update.route === "string" && update.route !== current.route;
	const base = routeChanged
		? {
				...DEFAULT_ASSISTANT_CONTEXT,
				timeZone: current.timeZone,
				taskIds: current.taskIds,
				taskProgress: current.taskProgress,
			}
		: current;
	return assistantContextSchema.parse({
		...base,
		...update,
		filters: { ...base.filters, ...update.filters },
	});
}
