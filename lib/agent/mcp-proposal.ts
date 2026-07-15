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

function isSensitiveArgumentKey(key: string): boolean {
	const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
	return (
		SENSITIVE_ARGUMENT_KEYS.has(normalized) ||
		["token", "secret", "password", "privatekey", "credential"].some((suffix) =>
			normalized.endsWith(suffix),
		)
	);
}

function assertNoSensitiveFields(value: unknown): void {
	if (Array.isArray(value)) {
		value.forEach(assertNoSensitiveFields);
		return;
	}
	if (!value || typeof value !== "object") return;
	for (const [key, nested] of Object.entries(value)) {
		if (isSensitiveArgumentKey(key)) {
			throw new Error("MCP arguments contain a sensitive field");
		}
		assertNoSensitiveFields(nested);
	}
}

function isSensitiveArgumentValue(value: string): boolean {
	return (
		/^\s*(?:Bearer|Basic)\s+\S+\s*$/i.test(value) ||
		/\bsk-[A-Za-z0-9_-]{8,}\b/.test(value) ||
		/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/.test(
			value,
		) ||
		/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/.test(
			value,
		) ||
		/-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY-----/.test(value)
	);
}

function assertNoSensitiveValues(value: unknown): void {
	if (typeof value === "string") {
		if (isSensitiveArgumentValue(value)) {
			throw new Error("MCP arguments contain a sensitive value");
		}
		return;
	}
	if (Array.isArray(value)) {
		value.forEach(assertNoSensitiveValues);
		return;
	}
	if (!value || typeof value !== "object") return;
	Object.values(value).forEach(assertNoSensitiveValues);
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
	if (serialized === undefined)
		throw new Error("MCP value is not JSON serializable");
	return serialized;
}

function digest(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function parseCanonicalJson<T>(value: string, label: string): T {
	try {
		return JSON.parse(value) as T;
	} catch {
		throw new Error(`MCP ${label} is not valid JSON`);
	}
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
	assertNoSensitiveValues(args);
	const argumentsJson = canonicalJson(args);
	if (Buffer.byteLength(argumentsJson, "utf8") > MAX_CANONICAL_ARGUMENT_BYTES) {
		throw new Error("MCP arguments are too large");
	}
	if (
		!inputSchema ||
		typeof inputSchema !== "object" ||
		Array.isArray(inputSchema)
	) {
		throw new Error("MCP tool schema is invalid");
	}
	assertNoSensitiveFields(inputSchema);
	const schemaJson = canonicalJson(inputSchema);
	if (Buffer.byteLength(schemaJson, "utf8") > MAX_CANONICAL_ARGUMENT_BYTES) {
		throw new Error("MCP tool schema is too large");
	}
	const canonicalArguments = parseCanonicalJson<Record<string, unknown>>(
		argumentsJson,
		"arguments",
	);
	const validator = new Ajv({ allErrors: true, strict: false }).compile(
		parseCanonicalJson<object>(schemaJson, "tool schema"),
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
