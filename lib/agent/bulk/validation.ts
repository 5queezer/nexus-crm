import { z } from "zod";

const filtersSchema = z.object({
  query: z.string().max(200).optional(),
  statuses: z.array(z.string().min(1).max(50)).max(20).optional(),
  sources: z.array(z.string().min(1).max(100)).max(50).optional(),
  remote: z.boolean().optional(),
  workModes: z.array(z.string().min(1).max(50)).max(20).optional(),
  triageQualityMin: z.number().int().min(1).max(5).optional(),
  followUpBefore: z.string().datetime({ offset: true }).optional(),
  archived: z.enum(["active", "archived", "all"]).optional(),
}).strict();

const scopeSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("selected"),
    applicationIds: z.array(z.string().min(1).max(32)).min(1).max(10_000),
  }).strict(),
  z.object({ mode: z.literal("all_matching"), filters: filtersSchema }).strict(),
]);

export const bulkPreviewRequestSchema = z.object({
  actionType: z.enum(["reschedule_follow_up", "archive", "restore"]),
  scope: scopeSchema,
  changes: z.object({
    followUpAt: z.string().datetime({ offset: true }).optional(),
  }).strict().optional(),
  reason: z.string().max(1_000).optional(),
  threadId: z.string().min(1).max(128).optional(),
  runId: z.string().min(1).max(128).optional(),
  idempotencyKey: z.string().min(8).max(200).optional(),
}).strict().superRefine((value, context) => {
  if (value.actionType === "reschedule_follow_up" && !value.changes?.followUpAt) {
    context.addIssue({ code: "custom", path: ["changes", "followUpAt"], message: "followUpAt is required" });
  }
  if (value.actionType !== "reschedule_follow_up" && value.changes?.followUpAt !== undefined) {
    context.addIssue({ code: "custom", path: ["changes"], message: "changes are not allowed for this action" });
  }
});

export const bulkRevisionRequestSchema = z.object({
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  excludedApplicationIds: z.array(z.string().min(1).max(32)).max(10_000).optional(),
  itemChanges: z.array(z.object({
    applicationId: z.string().min(1).max(32),
    followUpAt: z.string().datetime({ offset: true }),
  }).strict()).max(10_000).optional(),
  reason: z.string().max(1_000).optional(),
  idempotencyKey: z.string().min(8).max(200).optional(),
}).strict();

export const bulkDigestRequestSchema = z.object({
  digest: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
