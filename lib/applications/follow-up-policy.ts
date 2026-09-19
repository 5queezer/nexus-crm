/** Explicit user instructions take precedence over a suggested reminder date. */
export function followUpHoldReason(application: { notes?: string | null; jobSummary?: string | null; nextAction?: string | null }): string | null {
  const sentences = [application.nextAction, application.notes, application.jobSummary].filter(Boolean).join("\n").split(/[\n.!?]+/);
  return sentences.find((sentence) => /\b(do not|don't|no|not yet)\s+(?:send\s+(?:a\s+)?)?follow[ -]?up\b|\bwait\b[^\n.!?]{0,100}\b(feedback|repl(?:y|ies)|recruiter|response)\b|\b(kein(?:e[ns]?)?\s+(?:follow[ -]?up|nachfass\w*)|auf\s+.{0,60}(?:antwort|rückmeldung)\s+warten)\b/i.test(sentence))?.trim() ?? null;
}
