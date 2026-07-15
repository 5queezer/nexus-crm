import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSessionAuth } from "@/lib/session";
import {
	deleteCredential,
	getCredentialMetadata,
	getCredentialSecret,
	listUserCredentials,
	prismaCredentialRepository,
	saveCredential,
} from "@/lib/agent/credentials";
import { getProviderConfig, listProviderOptions } from "@/lib/agent/providers";

const credentialSchema = z.object({
	provider: z.string().trim().min(1).max(32),
	model: z.string().trim().min(1).max(128),
	apiKey: z.string().trim().min(8).max(8192).optional(),
});

function toMetadata(credential: {
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
}) {
	return {
		id: credential.id,
		provider: credential.provider,
		keyHint: credential.keyHint,
		defaultModel: credential.defaultModel,
		status: credential.status,
		lastValidatedAt: credential.lastValidatedAt,
		createdAt: credential.createdAt,
		updatedAt: credential.updatedAt,
	};
}

async function authenticatedUserId(): Promise<string | null> {
	const session = await requireSessionAuth({ allowDevBypass: false });
	return session?.userId ?? null;
}

export async function GET() {
	const userId = await authenticatedUserId();
	if (!userId)
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

	const credentials = await listUserCredentials(
		prismaCredentialRepository,
		userId,
	);
	const providerSecrets = Object.fromEntries(
		credentials
			.map((credential) => {
				try {
					return [
						credential.provider,
						getCredentialSecret(credential),
					] as const;
				} catch {
					return null;
				}
			})
			.filter((item): item is [string, string] => item !== null),
	);

	const providers = await listProviderOptions({ providerSecrets });
	const credentialMetadata = credentials.map(toMetadata);

	return NextResponse.json({ providers, credentials: credentialMetadata });
}

export async function PUT(request: Request) {
	const userId = await authenticatedUserId();
	if (!userId)
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

	const parsed = credentialSchema.safeParse(
		await request.json().catch(() => null),
	);
	if (!parsed.success) {
		return NextResponse.json(
			{ error: "Invalid credential configuration" },
			{ status: 400 },
		);
	}

	const providerConfig = getProviderConfig(parsed.data.provider);
	if (providerConfig.authMode === "oauth" && !parsed.data.apiKey) {
		return NextResponse.json(
			{ error: "OAuth credentials must be configured via the OAuth flow" },
			{ status: 400 },
		);
	}

	try {
		const credential = await saveCredential(
			prismaCredentialRepository,
			userId,
			parsed.data as { provider: string; model: string; apiKey: string },
		);
		return NextResponse.json({ credential });
	} catch (error) {
		const errorCode =
			error instanceof Error ? error.name.slice(0, 100) : "CredentialSaveError";
		console.error("Failed to save credential", {
			provider: parsed.data.provider,
			errorCode,
		});
		const message =
			error instanceof Error
				? error.message
				: "Credential configuration failed";
		const status = message.startsWith("Unsupported") ? 400 : 500;
		return NextResponse.json(
			{ error: status === 400 ? message : "Credential configuration failed" },
			{ status },
		);
	}
}

export async function DELETE(request: Request) {
	const userId = await authenticatedUserId();
	if (!userId)
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

	let requestUrl: URL;
	try {
		requestUrl = new URL(request.url);
	} catch {
		return NextResponse.json({ error: "Invalid request URL" }, { status: 400 });
	}

	const provider = requestUrl.searchParams.get("provider")?.trim();
	if (!provider) {
		return NextResponse.json(
			{ error: "Provider is required" },
			{ status: 400 },
		);
	}

	const metadata = await getCredentialMetadata(
		prismaCredentialRepository,
		userId,
		provider,
	);
	if (!metadata) {
		return NextResponse.json(
			{ error: "Credential not found" },
			{ status: 404 },
		);
	}

	await deleteCredential(prismaCredentialRepository, userId, provider);
	return new Response(null, { status: 204 });
}
