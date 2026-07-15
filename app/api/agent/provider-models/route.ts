import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSessionAuth } from "@/lib/session";
import {
	loadCredentialSecret,
	prismaCredentialRepository,
} from "@/lib/agent/credentials";
import {
	SUPPORTED_PROVIDERS,
	fetchModelsFromProviderApi,
} from "@/lib/agent/providers";
import {
	agentRequestErrorResponse,
	readBoundedJson,
} from "@/lib/agent/request";

const querySchema = z.object({
	provider: z
		.string()
		.trim()
		.toLowerCase()
		.refine((value: string) => SUPPORTED_PROVIDERS.includes(value as never), {
			message: "Unsupported provider",
		}),
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

	let body: unknown;
	try {
		body = await readBoundedJson(request);
	} catch (error) {
		return (
			agentRequestErrorResponse(error) ??
			NextResponse.json(
				{ error: "Invalid provider model request" },
				{ status: 400 },
			)
		);
	}
	const parsed = querySchema.safeParse(body);
	if (!parsed.success)
		return NextResponse.json(
			{ error: "Invalid provider model request" },
			{ status: 400 },
		);

	let key = parsed.data.apiKey;
	if (!key) {
		try {
			key = (
				await loadCredentialSecret(
					prismaCredentialRepository,
					userId,
					parsed.data.provider,
				)
			)?.apiKey;
		} catch {
			return NextResponse.json(
				{ error: "Stored provider credential could not be read" },
				{ status: 400 },
			);
		}
	}
	if (!key)
		return NextResponse.json(
			{ error: "API key is required for this provider" },
			{ status: 400 },
		);

	try {
		const models = await fetchModelsFromProviderApi(parsed.data.provider, key, {
			onlyOpenRouterFree: parsed.data.freeOnly,
		});
		return NextResponse.json({ models });
	} catch {
		return NextResponse.json(
			{ error: "Could not fetch models" },
			{ status: 502 },
		);
	}
}
