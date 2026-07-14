import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/session";
import {
  deleteCredential,
  getCredentialMetadata,
  prismaCredentialRepository,
  saveCredential,
} from "@/lib/agent/credentials";
import { listProviderOptions } from "@/lib/agent/providers";

const credentialSchema = z.object({
  provider: z.string().trim().min(1).max(32),
  model: z.string().trim().min(1).max(128),
  apiKey: z.string().trim().min(8).max(512),
});

async function authenticatedUserId(): Promise<string | null> {
  const session = await requireAuth({ allowDevBypass: false });
  return session?.userId ?? null;
}

export async function GET() {
  const userId = await authenticatedUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const providers = listProviderOptions();
  const credentials = (
    await Promise.all(
      providers.map((provider) =>
        getCredentialMetadata(prismaCredentialRepository, userId, provider.id),
      ),
    )
  ).filter((credential) => credential !== null);

  return NextResponse.json({ providers, credentials });
}

export async function PUT(request: Request) {
  const userId = await authenticatedUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = credentialSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid credential configuration" }, { status: 400 });
  }

  try {
    const credential = await saveCredential(
      prismaCredentialRepository,
      userId,
      parsed.data,
    );
    return NextResponse.json({ credential });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Credential configuration failed";
    const status = message.startsWith("Unsupported") ? 400 : 500;
    return NextResponse.json(
      { error: status === 400 ? message : "Credential configuration failed" },
      { status },
    );
  }
}

export async function DELETE(request: Request) {
  const userId = await authenticatedUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const provider = new URL(request.url).searchParams.get("provider")?.trim();
  if (!provider) {
    return NextResponse.json({ error: "Provider is required" }, { status: 400 });
  }
  await deleteCredential(prismaCredentialRepository, userId, provider);
  return new Response(null, { status: 204 });
}
