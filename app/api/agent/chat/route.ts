import type { ModelMessage } from "ai";
import { streamText } from "ai";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSessionAuth } from "@/lib/session";
import { getDb } from "@/lib/db";
import { prisma } from "@/lib/prisma";
import {
  loadCredentialSecret,
  prismaCredentialRepository,
} from "@/lib/agent/credentials";
import { createUserLanguageModel } from "@/lib/agent/providers";
import {
  addThreadMessage,
  completeAgentRun,
  createAgentRun,
  getAgentThread,
  prismaAgentRepository,
} from "@/lib/agent/store";
import {
  AGENT_LIMITS,
  agentStopCondition,
  buildAgentTools,
  buildBoundedHistory,
  buildMcpAgentTools,
} from "@/lib/agent/runtime";
import { prismaProposalRepository } from "@/lib/agent/proposals";
import { prismaConnectorRepository } from "@/lib/agent/connectors";
import { AGENT_SYSTEM_PROMPT } from "@/lib/agent/system-prompt";

const requestSchema = z.object({
  threadId: z.string().min(1).max(100),
  provider: z.enum(["openai", "anthropic"]),
  message: z.string().trim().min(1).max(12_000),
});

export async function POST(request: Request) {
  const session = await requireSessionAuth({ allowDevBypass: false });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid chat request" }, { status: 400 });

  const thread = await getAgentThread(
    prismaAgentRepository,
    session.userId,
    parsed.data.threadId,
  );
  if (!thread) return NextResponse.json({ error: "Thread not found" }, { status: 404 });

  const credential = await loadCredentialSecret(
    prismaCredentialRepository,
    session.userId,
    parsed.data.provider,
  );
  if (!credential) {
    return NextResponse.json(
      { error: "Configure your model credential before starting a run" },
      { status: 409 },
    );
  }

  await addThreadMessage(
    prismaAgentRepository,
    session.userId,
    thread.id,
    { role: "user", content: parsed.data.message },
  );
  if (thread.messages.length === 0 && thread.title === "New conversation") {
    await prisma.agentThread.updateMany({
      where: { id: thread.id, userId: session.userId },
      data: { title: parsed.data.message.replace(/\s+/g, " ").slice(0, 72) },
    });
  }
  const run = await createAgentRun({
    userId: session.userId,
    threadId: thread.id,
    provider: credential.provider,
    model: credential.model,
  });
  const history = buildBoundedHistory(
    thread.messages.filter(
      (message) => message.role === "user" || message.role === "assistant",
    ),
  );
  const messages: ModelMessage[] = [
    ...history.map((message) => ({
      role: message.role as "user" | "assistant",
      content: message.content,
    })),
    { role: "user", content: parsed.data.message },
  ];

  try {
    const result = streamText({
      model: createUserLanguageModel(credential),
      instructions: AGENT_SYSTEM_PROMPT,
      messages,
      tools: {
        ...buildAgentTools({
          db: await getDb(),
          proposalRepository: prismaProposalRepository,
          userId: session.userId,
          threadId: thread.id,
          runId: run.id,
        }),
        ...buildMcpAgentTools({
          connectorRepository: prismaConnectorRepository,
          proposalRepository: prismaProposalRepository,
          userId: session.userId,
          threadId: thread.id,
          runId: run.id,
        }),
      },
      stopWhen: agentStopCondition,
      timeout: {
        totalMs: AGENT_LIMITS.totalMs,
        stepMs: AGENT_LIMITS.stepMs,
        chunkMs: 20_000,
        toolMs: AGENT_LIMITS.toolMs,
      },
      maxRetries: 1,
      onFinish: async ({ text, finishReason, usage }) => {
        if (text.trim()) {
          await addThreadMessage(
            prismaAgentRepository,
            session.userId,
            thread.id,
            { role: "assistant", content: text, runId: run.id },
          );
        }
        await completeAgentRun(session.userId, run.id, {
          status: "completed",
          finishReason,
          inputTokens: usage.inputTokens ?? null,
          outputTokens: usage.outputTokens ?? null,
        });
      },
      onAbort: async () => {
        await completeAgentRun(session.userId, run.id, {
          status: "aborted",
          finishReason: "aborted",
        });
      },
      onError: async ({ error }) => {
        const errorCode = error instanceof Error ? error.name.slice(0, 100) : "ProviderError";
        console.error("Agent run failed", { runId: run.id, errorCode });
        await completeAgentRun(session.userId, run.id, {
          status: "failed",
          errorCode,
        });
      },
    });
    return result.toTextStreamResponse({
      headers: {
        "Cache-Control": "no-store",
        "X-Agent-Run-Id": run.id,
      },
    });
  } catch (error) {
    const errorCode = error instanceof Error ? error.name.slice(0, 100) : "ProviderError";
    console.error("Agent request failed", { runId: run.id, errorCode });
    await completeAgentRun(session.userId, run.id, {
      status: "failed",
      errorCode,
    });
    return NextResponse.json({ error: "The model request could not be started" }, { status: 502 });
  }
}
