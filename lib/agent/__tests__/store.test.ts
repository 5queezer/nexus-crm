import { describe, expect, it } from "vitest";
import type {
  AgentMessageView,
  AgentRepository,
  AgentThreadView,
} from "../store";
import {
  addThreadMessage,
  createAgentThread,
  deleteAgentThread,
  getAgentThread,
  listAgentThreads,
} from "../store";

class MemoryAgentRepository implements AgentRepository {
  threads: AgentThreadView[] = [];
  messages: AgentMessageView[] = [];

  async createThread(userId: string, title: string) {
    const now = new Date();
    const thread: AgentThreadView = {
      id: `thread-${this.threads.length + 1}`,
      userId,
      title,
      createdAt: now,
      updatedAt: now,
      messages: [],
      proposals: [],
    };
    this.threads.push(thread);
    return thread;
  }

  async listThreads(userId: string) {
    return this.threads.filter((thread) => thread.userId === userId);
  }

  async findThread(userId: string, threadId: string) {
    const thread = this.threads.find(
      (candidate) => candidate.userId === userId && candidate.id === threadId,
    );
    if (!thread) return null;
    return {
      ...thread,
      messages: this.messages.filter(
        (message) => message.userId === userId && message.threadId === threadId,
      ),
    };
  }

  async removeThread(userId: string, threadId: string) {
    const before = this.threads.length;
    this.threads = this.threads.filter(
      (thread) => !(thread.userId === userId && thread.id === threadId),
    );
    return this.threads.length !== before;
  }

  async createMessageForOwnedThread(input: Omit<AgentMessageView, "id" | "createdAt">) {
    const thread = this.threads.find(
      (candidate) => candidate.id === input.threadId && candidate.userId === input.userId,
    );
    if (!thread) return null;
    const message: AgentMessageView = {
      ...input,
      id: `message-${this.messages.length + 1}`,
      createdAt: new Date(),
    };
    this.messages.push(message);
    thread.updatedAt = new Date();
    return message;
  }
}

describe("agent thread store", () => {
  it("scopes listing and lookup to the authenticated user", async () => {
    const repository = new MemoryAgentRepository();
    const a = await createAgentThread(repository, "user-a", "My pipeline");
    await createAgentThread(repository, "user-b", "Other pipeline");

    expect(await listAgentThreads(repository, "user-a")).toHaveLength(1);
    expect(await getAgentThread(repository, "user-a", a.id)).not.toBeNull();
    expect(await getAgentThread(repository, "user-b", a.id)).toBeNull();
  });

  it("rejects messages for a thread the user does not own", async () => {
    const repository = new MemoryAgentRepository();
    const thread = await createAgentThread(repository, "user-a", "My pipeline");

    await expect(
      addThreadMessage(repository, "user-b", thread.id, {
        role: "user",
        content: "steal this thread",
      }),
    ).rejects.toThrow("Thread not found");
    expect(repository.messages).toHaveLength(0);
  });

  it("preserves multiline messages and refreshes thread recency", async () => {
    const repository = new MemoryAgentRepository();
    const thread = await createAgentThread(repository, "user-a", "My pipeline");
    thread.updatedAt = new Date("2026-07-01T00:00:00.000Z");
    const message = await addThreadMessage(repository, "user-a", thread.id, {
      role: "assistant",
      content: "Summary\n\n```ts\nconst ready = true;\n```",
    });

    expect(message.content).toBe("Summary\n\n```ts\nconst ready = true;\n```");
    expect(thread.updatedAt.getTime()).toBeGreaterThan(new Date("2026-07-01T00:00:00.000Z").getTime());
  });

  it("deletes only an owned thread", async () => {
    const repository = new MemoryAgentRepository();
    const thread = await createAgentThread(repository, "user-a", "My pipeline");

    expect(await deleteAgentThread(repository, "user-b", thread.id)).toBe(false);
    expect(await deleteAgentThread(repository, "user-a", thread.id)).toBe(true);
  });

  it("normalizes titles and message content to bounded visible text", async () => {
    const repository = new MemoryAgentRepository();
    const thread = await createAgentThread(repository, "user-a", "   A   useful thread   ");
    const message = await addThreadMessage(repository, "user-a", thread.id, {
      role: "user",
      content: "  hello operator  ",
    });

    expect(thread.title).toBe("A useful thread");
    expect(message.content).toBe("hello operator");
  });
});
