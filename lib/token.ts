import { randomBytes, createHash, timingSafeEqual } from "crypto";

export function generateApiToken(): { raw: string; hash: string } {
  const raw = `jt_${randomBytes(32).toString("hex")}`;
  const hash = createHash("sha256").update(raw).digest("hex");
  return { raw, hash };
}

export function hashApiToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/**
 * Constant-time string comparison to prevent timing attacks.
 * Returns false if either value is empty.
 */
export function safeCompare(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
