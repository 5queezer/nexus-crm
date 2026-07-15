import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSessionAuth } from "@/lib/session";
import {
	loadCredentialSecret,
	prismaCredentialRepository,
} from "@/lib/agent/credentials";
import {
	fetchModelsFromProviderApi,
	getProviderConfig,
} from "@/lib/agent/providers";

const querySchema = z.object({
	provider: z.string().trim().min(1).max(32),
	apiKey: z.string().trim().min(8).max(8192).optional(),
	freeOnly: z.boolean().optional(),
});

async function authenticatedUserId(): Promise<string | null> {
	const session = await requireSessionAuth({ allowDevBypass: false });
	return session?.userId ?? null;
}

export async function POST(request: Request) {
	const userId = await authenticatedUserId();
	if (!userId)
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

	const parsed = querySchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) {
		return NextResponse.json(
			{ error: "Invalid provider model request" },
			{ status: 400 },
		);
	}

	const providerConfig = getProviderConfig(parsed.data.provider);
	const credential = await loadCredentialSecret(
		prismaCredentialRepository,
		userId,
		parsed.data.provider,
	);

	if (providerConfig.authMode === "oauth") {
		if (!credential) {
			return NextResponse.json(
				{ error: "Use the provider OAuth flow to configure credentials first" },
				{ status: 400 },
			);
		}
		if (parsed.data.apiKey) {
			try {
				const response = await fetchModelsFromProviderApi(
					providerConfig.id,
					parsed.data.apiKey,
					{ onlyOpenRouterFree: parsed.data.freeOnly },
				);
				return NextResponse.json({ models: response });
			} catch {
				return NextResponse.json(
					{ error: "Could not fetch models" },
					{ status: 502 },
				);
			}
		}
		try {
			const response = await fetchModelsFromProviderApi(
				providerConfig.id,
				credential.apiKey,
				{ onlyOpenRouterFree: parsed.data.freeOnly },
			);
			return NextResponse.json({ models: response });
		} catch {
			return NextResponse.json(
				{ error: "Could not fetch models" },
				{ status: 502 },
			);
		}
	}

	if (!parsed.data.apiKey && !credential) {
		return NextResponse.json(
			{ error: "API key is required for this provider" },
			{ status: 400 },
		);
	}

	const key = parsed.data.apiKey ?? credential?.apiKey;
	if (!key) {
		return NextResponse.json(
			{ error: "Unable to resolve provider credential" },
			{ status: 500 },
		);
	}

	try {
		const response = await fetchModelsFromProviderApi(providerConfig.id, key, {
			onlyOpenRouterFree: parsed.data.freeOnly,
		});
		return NextResponse.json({ models: response });
	} catch {
		return NextResponse.json(
			{ error: "Could not fetch models" },
			{ status: 502 },
		);
	}
}
