import { z } from "zod/v3";

// Shared by every MCP application write path. No defaults: omitted fields must
// not erase an existing assessment, while explicit null/false must survive.
export const applicationTriageToolFields = {
  companySize: z.enum(["micro", "small", "mid", "large", "enterprise"])
    .nullable().optional().describe("Company size bucket; null clears an unknown size"),
  salaryBandMentioned: z.boolean().optional()
    .describe("Whether the source explicitly mentions a salary band"),
  triageQuality: z.number().int().min(1).max(5).nullable().optional()
    .describe("Triage priority 1-5; null clears the assessment (distinct from rating)"),
  triageReason: z.string().max(1000).nullable().optional()
    .describe("Evidence, fit, blockers, and next step for the triage decision"),
  incomingSource: z.enum(["linkedin", "email", "referral", "outbound"])
    .nullable().optional().describe("Original opportunity discovery channel"),
};

const applicationTriageSchema = z.object(applicationTriageToolFields);

export function parseApplicationTriage(input: unknown) {
  return applicationTriageSchema.parse(input);
}
