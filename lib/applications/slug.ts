const MAX_SLUG_LENGTH = 96;
const AUDIENCE_SUFFIX = /(?:\s*[-–—,:|/]?\s*)?\((?:f|m|d|w|x)(?:\s*[/|]\s*(?:f|m|d|w|x)){1,4}\)\s*$/giu;

function transliterate(value: string): string {
  return value
    .replace(/ä/giu, "ae")
    .replace(/ö/giu, "oe")
    .replace(/ü/giu, "ue")
    .replace(/[ßẞ]/gu, "ss")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function applicationSlug(
  company: string | null | undefined,
  role: string | null | undefined,
): string {
  const normalizedRole = (role ?? "").replace(AUDIENCE_SUFFIX, "");
  const combined = `${company ?? ""} ${normalizedRole}`;
  const slug = transliterate(combined)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, "");

  return slug || "application";
}

export function applicationPath(application: {
  id: string;
  company: string;
  role: string;
}): string {
  return `/applications/${encodeURIComponent(application.id)}/${encodeURIComponent(
    applicationSlug(application.company, application.role),
  )}`;
}
