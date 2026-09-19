type FollowUpContext = {
  notes?: string | null;
  jobSummary?: string | null;
  nextAction?: string | null;
};

const instructionPrefix = String.raw`^(?:[-*•]\s*)?(?:(?:next\s+action|action|instruction|nächste\s+aktion|nächster\s+schritt|anweisung)\s*:\s*)?(?:(?:please|bitte)\s+)?`;
const explicitHoldPatterns = [
  new RegExp(`${instructionPrefix}(?:(?:do\\s+not|don't)\\s+(?:send\\s+(?:a\\s+)?)?follow[ -]?up\\b|not\\s+yet\\s+(?:send\\s+(?:a\\s+)?)?follow[ -]?up\\b)`, "i"),
  new RegExp(`${instructionPrefix}no\\s+follow[ -]?up(?:\\s+(?:until|before)\\b|\\s*$)`, "i"),
  new RegExp(`${instructionPrefix}wait\\b.{0,100}\\b(?:feedback|repl(?:y|ies)|recruiter|response)\\b`, "i"),
  new RegExp(`${instructionPrefix}(?:(?:vorerst\\s+)?kein(?:e[ns]?)?\\s+(?:follow[ -]?up|nachfass\\w*|nachfrag\\w*)(?=\\s*$|\\s+(?:bis|vor|bevor)\\b)|auf\\s+.{0,60}(?:antwort|rückmeldung)\\s+warten\\b)`, "i"),
];

function findExplicitHold(value: string | null | undefined): string | null {
  if (!value) return null;
  const clauses = value.split(/[\n.!?;]+/).map((clause) => clause.trim()).filter(Boolean);
  return clauses.find((clause) => explicitHoldPatterns.some((pattern) => pattern.test(clause))) ?? null;
}

/** Explicit current instructions take precedence over a suggested reminder date. */
export function followUpHoldReason(application: FollowUpContext): string | null {
  return findExplicitHold(application.nextAction)
    ?? findExplicitHold(application.notes)
    ?? findExplicitHold(application.jobSummary);
}
