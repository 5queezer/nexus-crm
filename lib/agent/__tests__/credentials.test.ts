import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CredentialRecord, CredentialRepository } from "../credentials";
import {
	deleteCredential,
	getCredentialMetadata,
	loadCredentialSecret,
	saveCredential,
} from "../credentials";
import { getProviderConfig } from "../providers";

const KEY = "22".repeat(32);

class MemoryCredentialRepository implements CredentialRepository {
	records = new Map<string, CredentialRecord>();

	async find(userId: string, provider: string) {
		return this.records.get(`${userId}:${provider}`) ?? null;
	}

	async findMany(userId: string) {
		return Array.from(this.records.values()).filter(
			(record) => record.userId === userId,
		);
	}

	async upsert(
		record: Omit<CredentialRecord, "id" | "createdAt" | "updatedAt">,
	) {
		const key = `${record.userId}:${record.provider}`;
		const existing = this.records.get(key);
		const now = new Date();
		const saved: CredentialRecord = {
			...record,
			id: existing?.id ?? `credential-${this.records.size + 1}`,
			createdAt: existing?.createdAt ?? now,
			updatedAt: now,
		};
		this.records.set(key, saved);
		return saved;
	}

	async remove(userId: string, provider: string) {
		return this.records.delete(`${userId}:${provider}`);
	}
}

describe("provider policy", () => {
	it("rejects unsupported providers", () => {
		expect(() => getProviderConfig("unknown")).toThrow("Unsupported provider");
	});
});

describe("per-user credentials", () => {
	let repository: MemoryCredentialRepository;

	beforeEach(() => {
		process.env.AGENT_SECRET_ENCRYPTION_KEY = KEY;
		repository = new MemoryCredentialRepository();
	});

	afterEach(() => {
		delete process.env.AGENT_SECRET_ENCRYPTION_KEY;
	});

	it("stores encrypted credentials and returns metadata only", async () => {
		const metadata = await saveCredential(repository, "user-a", {
			provider: "openai",
			model: "gpt-5.4-mini",
			apiKey: "sk-user-a-12345678",
		});

		const stored = repository.records.get("user-a:openai");
		expect(stored?.encryptedApiKey).not.toContain("sk-user-a-12345678");
		expect(metadata).toMatchObject({
			provider: "openai",
			defaultModel: "gpt-5.4-mini",
			keyHint: "••••5678",
			status: "configured",
		});
		expect(JSON.stringify(metadata)).not.toContain("sk-user-a-12345678");
	});

	it("rotates only the authenticated user's provider credential", async () => {
		await saveCredential(repository, "user-a", {
			provider: "openai",
			model: "gpt-5.4-mini",
			apiKey: "sk-first-1111",
		});
		await saveCredential(repository, "user-b", {
			provider: "openai",
			model: "gpt-5.4-mini",
			apiKey: "sk-other-2222",
		});
		await saveCredential(repository, "user-a", {
			provider: "openai",
			model: "gpt-5.4",
			apiKey: "sk-rotated-3333",
		});

		expect(
			await loadCredentialSecret(repository, "user-a", "openai"),
		).toMatchObject({
			apiKey: "sk-rotated-3333",
			model: "gpt-5.4",
		});
		expect(
			await loadCredentialSecret(repository, "user-b", "openai"),
		).toMatchObject({
			apiKey: "sk-other-2222",
		});
	});

	it("does not expose another user's metadata and scopes deletion", async () => {
		await saveCredential(repository, "user-a", {
			provider: "anthropic",
			model: "claude-sonnet-4-6",
			apiKey: "sk-ant-secret",
		});

		expect(
			await getCredentialMetadata(repository, "user-b", "anthropic"),
		).toBeNull();
		expect(await deleteCredential(repository, "user-b", "anthropic")).toBe(
			false,
		);
		expect(
			await getCredentialMetadata(repository, "user-a", "anthropic"),
		).not.toBeNull();
		expect(await deleteCredential(repository, "user-a", "anthropic")).toBe(
			true,
		);
	});
});
