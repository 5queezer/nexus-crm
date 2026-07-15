import { z } from "zod/v3";

/**
 * The transport schema is intentionally permissive. The adapter must inspect the
 * raw value after idempotency lookup so exact legacy replays and changed malformed
 * retries preserve their required precedence. New writes are validated strictly
 * at the adapter boundary.
 */
export const submissionPolicyTransportSchema = z.unknown().optional().describe(
  "Required object for new submissions: humanReviewed, identityConsistent, factsVerified, profileConsistencyStatus, optional confirmedNoAnswers and audited override reasons. Omitted, null, or malformed values reach adapter replay resolution; invalid policy on a new submission is rejected there.",
);
