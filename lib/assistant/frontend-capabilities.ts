import { z } from "zod";
import { assistantFiltersSchema } from "./context";

const id = z.string().trim().min(1).max(100);

export const frontendCapabilityCommandSchema = z.discriminatedUnion("name", [
	z.object({
		name: z.literal("navigate"),
		arguments: z.object({
			page: z.enum([
				"opportunities",
				"activity",
				"documents",
				"analytics",
				"settings",
			]),
		}),
	}),
	z.object({
		name: z.literal("set_filters"),
		arguments: assistantFiltersSchema.extend({
			statuses: z.array(id).max(1).optional(),
			sources: z.array(id).max(1).optional(),
			workModes: z.array(id).max(1).optional(),
		}),
	}),
	z.object({
		name: z.literal("select_ids"),
		arguments: z.object({ applicationIds: z.array(id).max(2_000) }),
	}),
	z.object({
		name: z.literal("open_record"),
		arguments: z.object({
			applicationId: id,
			tab: z.enum(["activity", "brief", "materials", "contacts"]).optional(),
		}),
	}),
	z.object({
		name: z.literal("open_tab"),
		arguments: z.object({
			applicationId: id,
			tab: z.enum(["activity", "brief", "materials", "contacts"]),
		}),
	}),
	z.object({
		name: z.literal("highlight_field"),
		arguments: z.object({ applicationId: id.optional(), field: id }),
	}),
	z.object({
		name: z.literal("open_review"),
		arguments: z.object({ commandId: id }),
	}),
]);

export type FrontendCapabilityCommand = z.infer<
	typeof frontendCapabilityCommandSchema
>;
