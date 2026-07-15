import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSessionAuth } from "@/lib/session";
import {
	deleteCredential,
	getCredentialMetadata,
	listUserCredentials,
	prismaCredentialRepository,
	saveCredential,
} from "@/lib/agent/credentials";
import {
	SUPPORTED_PROVIDERS,
	getProviderConfig,
	listProviderOptions,
} from "@/lib/agent/providers";
import {
	agentRequestErrorResponse,
	readBoundedJson,
} from "@/lib/agent/request";

const providerSchema = z
	.string()
	.trim()
	.toLowerCase()
	.refine((value) => SUPPORTED_PROVIDERS.includes(value as never), {
		message: "Unsupported provider",
	});

const credentialSchema = z.object({
	provider: providerSchema,
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
	// This endpoint intentionally remains metadata-only. Provider discovery is lazy.
	const providers = await listProviderOptions();
	return NextResponse.json({
		providers,
		credentials: credentials.map(toMetadata),
	});
}

export async function PUT(request: Request) {
	const userId = await authenticatedUserId();
	if (!userId)
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

	let body: unknown;
	try {
		body = await readBoundedJson(request);
	} catch (error) {
		return (
			agentRequestErrorResponse(error) ??
			NextResponse.json(
				{ error: "Invalid credential configuration" },
				{ status: 400 },
			)
		);
	}
	const parsed = credentialSchema.safeParse(body);
	if (!parsed.success)
		return NextResponse.json(
			{ error: "Invalid credential configuration" },
			{ status: 400 },
		);

	const existing = await getCredentialMetadata(
		prismaCredentialRepository,
		userId,
		parsed.data.provider,
	);
	getProviderConfig(parsed.data.provider);
	if (!parsed.data.apiKey && !existing) {
		return NextResponse.json(
			{ error: "API key is required for this provider" },
			{ status: 400 },
		);
	}

	try {
		const credential = await saveCredential(
			prismaCredentialRepository,
			userId,
			parsed.data,
		);
		return NextResponse.json({ credential });
	} catch (error) {
		const errorCode =
			error instanceof Error ? error.name.slice(0, 100) : "CredentialSaveError";
		console.error("Failed to save credential", {
			provider: parsed.data.provider,
			errorCode,
		});
		return NextResponse.json(
			{ error: "Credential configuration failed" },
			{ status: 500 },
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

	const parsedProvider = providerSchema.safeParse(
		requestUrl.searchParams.get("provider"),
	);
	if (!parsedProvider.success)
		return NextResponse.json(
			{ error: "Provider is required" },
			{ status: 400 },
		);
	const metadata = await getCredentialMetadata(
		prismaCredentialRepository,
		userId,
		parsedProvider.data,
	);
	if (!metadata)
		return NextResponse.json(
			{ error: "Credential not found" },
			{ status: 404 },
		);
	await deleteCredential(
		prismaCredentialRepository,
		userId,
		parsedProvider.data,
	);
	return new Response(null, { status: 204 });
}
