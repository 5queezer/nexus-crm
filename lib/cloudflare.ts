import { createHmac } from "node:crypto";

const CHALLENGE_TTL_MS = 60 * 60 * 1000; // 1 hour

// ---------------------------------------------------------------------------
// Turnstile server-side verification
// ---------------------------------------------------------------------------

interface TurnstileResult {
  success: boolean;
  "error-codes"?: string[];
}

/**
 * Verify a Turnstile token with the Cloudflare siteverify endpoint.
 * Returns true when the challenge was solved by a real user.
 */
export async function verifyTurnstile(
  token: string,
  ip: string,
): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return true; // Turnstile not configured — allow through

  const form = new URLSearchParams();
  form.set("secret", secret);
  form.set("response", token);
  form.set("remoteip", ip);

  const res = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    { method: "POST", body: form },
  );

  if (!res.ok) return false;
  const data = (await res.json()) as TurnstileResult;
  return data.success === true;
}

// ---------------------------------------------------------------------------
// Signed challenge cookie — proves the visitor passed Turnstile recently.
// Format: <expiry-epoch-ms>.<hmac-hex>
// ---------------------------------------------------------------------------

function getHmacKey(): string {
  // Reuse the auth secret as HMAC key; it's always set in production.
  return process.env.BETTER_AUTH_SECRET ?? "dev-fallback-key";
}

function hmac(data: string): string {
  return createHmac("sha256", getHmacKey()).update(data).digest("hex");
}

/**
 * Create a signed challenge token containing the client IP and expiry.
 * The token is bound to the IP so it cannot be transferred between visitors.
 */
export function createChallengeToken(ip: string): string {
  const expiry = Date.now() + CHALLENGE_TTL_MS;
  const payload = `${expiry}.${ip}`;
  return `${payload}.${hmac(payload)}`;
}

/**
 * Verify a challenge cookie value. Returns true when the signature is valid,
 * the token has not expired, and the IP matches.
 */
export function verifyChallengeToken(token: string, ip: string): boolean {
  const parts = token.split(".");
  if (parts.length !== 3) return false;

  const [expiryStr, tokenIp, sig] = parts;
  const payload = `${expiryStr}.${tokenIp}`;

  if (hmac(payload) !== sig) return false;
  if (tokenIp !== ip) return false;

  const expiry = Number(expiryStr);
  if (Number.isNaN(expiry) || Date.now() > expiry) return false;

  return true;
}
