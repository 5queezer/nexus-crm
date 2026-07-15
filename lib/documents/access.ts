export interface SubmissionDocumentLike {
  submissionId?: string | null;
  state?: string | null;
}

export function isSubmissionDocument(document: SubmissionDocumentLike): boolean {
  return Boolean(document.submissionId)
    || document.state === "submitted"
    || document.state === "historical";
}

export function requiresSubmissionScopeForDocumentMutation(
  document: SubmissionDocumentLike,
  requestedState?: string,
): boolean {
  return isSubmissionDocument(document)
    || requestedState === "submitted"
    || requestedState === "historical";
}