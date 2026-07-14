import { createHash } from "node:crypto";
import Ajv from "ajv";

const MAX_CANONICAL_ARGUMENT_BYTES = 32 * 1024;
const SENSITIVE_ARGUMENT_KEYS = new Set([
  "authorization",
  "password",
  "secret",
  "apikey",
  "accesstoken",
  "refreshtoken",
  "credential",
  "privatekey",
]);

function assertNoSensitiveFields(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(assertNoSensitiveFields);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if (SENSITIVE_ARGUMENT_KEYS.has(key.toLowerCase().replace(/[^a-z0-9]/g, ""))) {
      throw new Error("MCP arguments contain a sensitive field");
    }
    assertNoSensitiveFields(nested);
  }
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, sortJson(nested)]),
    );
  }
  return value;
}

function canonicalJson(value: unknown): string {
  const serialized = JSON.stringify(sortJson(value));
  if (serialized === undefined) throw new Error("MCP value is not JSON serializable");
  return serialized;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function canonicalizeMcpCall(
  args: Record<string, unknown>,
  inputSchema: unknown,
): {
  arguments: Record<string, unknown>;
  argumentsHash: string;
  schemaHash: string;
} {
  assertNoSensitiveFields(args);
  const argumentsJson = canonicalJson(args);
  if (Buffer.byteLength(argumentsJson, "utf8") > MAX_CANONICAL_ARGUMENT_BYTES) {
    throw new Error("MCP arguments are too large");
  }
  if (!inputSchema || typeof inputSchema !== "object" || Array.isArray(inputSchema)) {
    throw new Error("MCP tool schema is invalid");
  }
  const schemaJson = canonicalJson(inputSchema);
  if (Buffer.byteLength(schemaJson, "utf8") > MAX_CANONICAL_ARGUMENT_BYTES) {
    throw new Error("MCP tool schema is too large");
  }
  const canonicalArguments = JSON.parse(argumentsJson) as Record<string, unknown>;
  const validator = new Ajv({ allErrors: true, strict: false }).compile(
    JSON.parse(schemaJson) as object,
  );
  if (!validator(canonicalArguments)) {
    throw new Error("MCP arguments do not match the tool schema");
  }
  return {
    arguments: canonicalArguments,
    argumentsHash: digest(argumentsJson),
    schemaHash: digest(schemaJson),
  };
}
