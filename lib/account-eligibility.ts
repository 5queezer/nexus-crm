function parseAllowedEmails(): string[] {
  return (process.env.ALLOWED_EMAIL ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function isEmailAllowed(email: string): boolean {
  const allowedEmails = parseAllowedEmails();
  return allowedEmails.length === 0 || allowedEmails.includes(email.trim().toLowerCase());
}

export function isExplicitlyAllowedEmail(email: string): boolean {
  return parseAllowedEmails().includes(email.trim().toLowerCase());
}
