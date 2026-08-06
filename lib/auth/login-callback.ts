const FALLBACK_CALLBACK_URL = "/";

export function safeInternalCallbackURL(value: string | null | undefined): string {
  if (!value || value.length > 2048 || !value.startsWith("/") || value.startsWith("//")) {
    return FALLBACK_CALLBACK_URL;
  }
  if (/[\\\u0000-\u001f\u007f]/.test(value)) {
    return FALLBACK_CALLBACK_URL;
  }

  let decoded = value;
  let stabilized = false;
  try {
    for (let pass = 0; pass < 8; pass += 1) {
      const next = decodeURIComponent(decoded);
      if (next === decoded) {
        stabilized = true;
        break;
      }
      decoded = next;
      if (!decoded.startsWith("/") || decoded.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(decoded)) {
        return FALLBACK_CALLBACK_URL;
      }
    }
  } catch {
    return FALLBACK_CALLBACK_URL;
  }

  // Fail closed instead of accepting a payload that remains encoded deeply
  // enough to change meaning in a later decoder.
  if (!stabilized) return FALLBACK_CALLBACK_URL;

  if (!decoded.startsWith("/") || decoded.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(decoded)) {
    return FALLBACK_CALLBACK_URL;
  }

  try {
    const parsed = new URL(decoded, "https://nexus.invalid");
    if (parsed.origin !== "https://nexus.invalid") return FALLBACK_CALLBACK_URL;
  } catch {
    return FALLBACK_CALLBACK_URL;
  }

  return value;
}
