import { prisma } from "@/lib/prisma";
import { decryptSecret, encryptSecret, secretHint } from "./secrets";
import { getProviderConfig } from "./providers";

export type CredentialRecord = {
	id: string;
	userId: string;
	provider: string;
	encryptedApiKey: string;
	keyHint: string;
	defaultModel: string;
	status: string;
	lastValidatedAt: Date | null;
	createdAt: Date;
	updatedAt: Date;
};

export interface CredentialRepository {
	find(userId: string, provider: string): Promise<CredentialRecord | null>;
	findMany(userId: string): Promise<CredentialRecord[]>;
	upsert(
		record: Omit<CredentialRecord, "id" | "createdAt" | "updatedAt">,
	): Promise<CredentialRecord>;
	updateModel(
		userId: string,
		provider: string,
		defaultModel: string,
	): Promise<CredentialRecord>;
	remove(userId: string, provider: string): Promise<boolean>;
}

export type CredentialMetadata = Omit<
	CredentialRecord,
	"userId" | "encryptedApiKey"
>;

export async function listUserCredentials(
	repository: CredentialRepository,
	userId: string,
): Promise<CredentialRecord[]> {
	return repository.findMany(userId);
}

export function getCredentialSecret(record: CredentialRecord): string {
	return decryptSecret(record.encryptedApiKey, `llm:${record.provider}`);
}

export const prismaCredentialRepository: CredentialRepository = {
	find(userId, provider) {
		return prisma.llmCredential.findUnique({
			where: { userId_provider: { userId, provider } },
		});
	},
	findMany(userId) {
		return prisma.llmCredential.findMany({
			where: { userId },
			orderBy: { provider: "asc" },
		});
	},
	upsert(record) {
		const { userId, provider, ...values } = record;
		return prisma.llmCredential.upsert({
			where: { userId_provider: { userId, provider } },
			create: { userId, provider, ...values },
			update: values,
		});
	},
	updateModel(userId, provider, defaultModel) {
		return prisma.llmCredential.update({
			where: { userId_provider: { userId, provider } },
			data: { defaultModel },
		});
	},
	async remove(userId, provider) {
		const result = await prisma.llmCredential.deleteMany({
			where: { userId, provider },
		});
		return result.count > 0;
	},
};

function metadata(record: CredentialRecord): CredentialMetadata {
	return {
		id: record.id,
		provider: record.provider,
		keyHint: record.keyHint,
		defaultModel: record.defaultModel,
		status: record.status,
		lastValidatedAt: record.lastValidatedAt,
		createdAt: record.createdAt,
		updatedAt: record.updatedAt,
	};
}

export async function saveCredential(
	repository: CredentialRepository,
	userId: string,
	input: { provider: string; model: string; apiKey?: string },
): Promise<CredentialMetadata> {
	const provider = input.provider.trim().toLowerCase();
	const model = input.model.trim();
	const apiKey = input.apiKey?.trim();
	if (!provider) throw new Error("Provider is required");
	if (!model) throw new Error("Model is required");
	getProviderConfig(provider);

	if (!apiKey) {
		const saved = await repository.updateModel(userId, provider, model);
		return metadata(saved);
	}
	if (apiKey.length < 8 || apiKey.length > 8192) {
		throw new Error("Secret credential must be between 8 and 8192 characters");
	}

	const saved = await repository.upsert({
		userId,
		provider,
		encryptedApiKey: encryptSecret(apiKey, `llm:${provider}`),
		keyHint: secretHint(apiKey),
		defaultModel: model,
		status: "configured",
		lastValidatedAt: null,
	});
	return metadata(saved);
}

export async function getCredentialMetadata(
	repository: CredentialRepository,
	userId: string,
	provider: string,
): Promise<CredentialMetadata | null> {
	const record = await repository.find(userId, provider.trim().toLowerCase());
	return record ? metadata(record) : null;
}

export async function loadCredentialSecret(
	repository: CredentialRepository,
	userId: string,
	provider: string,
): Promise<{ provider: string; model: string; apiKey: string } | null> {
	const normalizedProvider = provider.trim().toLowerCase();
	const record = await repository.find(userId, normalizedProvider);
	if (!record) return null;
	getProviderConfig(record.provider);
	return {
		provider: record.provider,
		model: record.defaultModel,
		apiKey: decryptSecret(record.encryptedApiKey, `llm:${record.provider}`),
	};
}

export function deleteCredential(
	repository: CredentialRepository,
	userId: string,
	provider: string,
): Promise<boolean> {
	return repository.remove(userId, provider.trim().toLowerCase());
}
