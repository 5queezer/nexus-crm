import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from "node:crypto";

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;

function masterKey(): Buffer {
  const value = process.env.AGENT_SECRET_ENCRYPTION_KEY;
  if (!value || !/^[0-9a-f]{64}$/i.test(value)) {
    throw new Error(
      "AGENT_SECRET_ENCRYPTION_KEY must be set (64 hex chars = 32 bytes)",
    );
  }
  return Buffer.from(value, "hex");
}

function purposeKey(purpose: string): Buffer {
  if (!purpose.trim()) throw new Error("Secret encryption purpose is required");
  return createHmac("sha256", masterKey())
    .update(`nexus-agent:${purpose}`)
    .digest();
}

export function encryptSecret(plaintext: string, purpose: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, purposeKey(purpose), iv);
  cipher.setAAD(Buffer.from(`${VERSION}:${purpose}`, "utf8"));
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64url"),
    ciphertext.toString("base64url"),
    tag.toString("base64url"),
  ].join(".");
}

export function decryptSecret(envelope: string, purpose: string): string {
  try {
    const [version, encodedIv, encodedCiphertext, encodedTag, extra] =
      envelope.split(".");
    if (
      version !== VERSION ||
      !encodedIv ||
      !encodedCiphertext ||
      !encodedTag ||
      extra
    ) {
      throw new Error("invalid envelope");
    }
    const iv = Buffer.from(encodedIv, "base64url");
    const ciphertext = Buffer.from(encodedCiphertext, "base64url");
    const tag = Buffer.from(encodedTag, "base64url");
    if (iv.length !== IV_BYTES || tag.length !== 16) {
      throw new Error("invalid envelope lengths");
    }
    const decipher = createDecipheriv(ALGORITHM, purposeKey(purpose), iv);
    decipher.setAAD(Buffer.from(`${VERSION}:${purpose}`, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error("Unable to decrypt stored secret");
  }
}

export function secretHint(secret: string): string {
  return secret.length >= 4 ? `••••${secret.slice(-4)}` : "••••";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function redactSensitiveText(
  input: unknown,
  explicitSecrets: string[] = [],
): string {
  let text = input instanceof Error ? input.message : String(input ?? "");
  text = text
    .replace(/(authorization\s*:\s*bearer\s+)[^\s;,]+/gi, "$1[REDACTED]")
    .replace(/((?:api[_-]?key|token|secret)\s*[=:]\s*)[^\s;,]+/gi, "$1[REDACTED]");
  for (const secret of explicitSecrets.filter(Boolean)) {
    text = text.replace(new RegExp(escapeRegExp(secret), "g"), "[REDACTED]");
  }
  return text;
}
