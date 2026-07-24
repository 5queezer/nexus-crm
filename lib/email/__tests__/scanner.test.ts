import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  integrationFind: vi.fn(),
  integrationUpdate: vi.fn(),
  scannedFindMany: vi.fn(),
  scannedCreate: vi.fn(),
  scannedDelete: vi.fn(),
  scannedUpdate: vi.fn(),
  applicationFind: vi.fn(),
  applicationCreate: vi.fn(),
  fetchNewMessages: vi.fn(),
  getMessageDetail: vi.fn(),
  classifyEmail: vi.fn(),
  recordLifecycle: vi.fn(),
  createLifecycle: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    emailIntegration: {
      findUnique: mocks.integrationFind,
      update: mocks.integrationUpdate,
    },
    scannedEmail: {
      findMany: mocks.scannedFindMany,
      create: mocks.scannedCreate,
      delete: mocks.scannedDelete,
      update: mocks.scannedUpdate,
    },
    application: {
      findFirst: mocks.applicationFind,
      create: mocks.applicationCreate,
    },
  },
}));
vi.mock("../gmail", () => ({
  fetchNewMessages: mocks.fetchNewMessages,
  getMessageDetail: mocks.getMessageDetail,
}));
vi.mock("../classifier", () => ({ classifyEmail: mocks.classifyEmail }));
vi.mock("../application-events", () => ({
  recordEmailLifecycleTransition: mocks.recordLifecycle,
  createEmailApplicationWithLifecycle: mocks.createLifecycle,
}));
vi.mock("@/lib/logger", () => ({ logger: { error: mocks.loggerError } }));

import { scanUserInbox } from "../scanner";

const receivedAt = new Date("2026-07-24T09:00:00Z");

describe("scanUserInbox auto-import retries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.integrationFind.mockResolvedValue({
      enabled: true,
      encryptedToken: "encrypted",
      lastHistoryId: "history-old",
      scanDaysBack: 7,
      autoImport: "auto",
    });
    mocks.fetchNewMessages.mockResolvedValue({
      messages: [{ id: "message-1" }],
      latestHistoryId: "history-new",
    });
    mocks.scannedFindMany.mockResolvedValue([]);
    mocks.getMessageDetail.mockResolvedValue({
      messageId: "message-1",
      subject: "Interview invitation",
      sender: "recruiter@example.com",
      bodySnippet: "Let us schedule an interview",
      receivedAt,
    });
    mocks.classifyEmail.mockReturnValue({
      classification: "interview",
      confidence: "high",
      company: "Acme",
      role: "Engineer",
    });
    mocks.scannedCreate.mockResolvedValue({ id: 7 });
    mocks.applicationFind.mockResolvedValue({
      id: 42,
      status: "applied",
      updatedAt: new Date("2026-07-24T08:00:00Z"),
    });
    mocks.scannedDelete.mockResolvedValue({});
    mocks.scannedUpdate.mockResolvedValue({});
    mocks.createLifecycle.mockResolvedValue(42);
    mocks.integrationUpdate.mockResolvedValue({});
  });

  it("keeps the Gmail history cursor on an auto-import conflict", async () => {
    mocks.recordLifecycle.mockRejectedValueOnce(new Error("conflict"));

    const result = await scanUserInbox("owner-1");

    expect(result.autoImported).toBe(0);
    expect(mocks.scannedDelete).toHaveBeenCalledWith({ where: { id: 7 } });
    expect(mocks.integrationUpdate).toHaveBeenCalledWith({
      where: { userId: "owner-1" },
      data: {
        lastHistoryId: "history-old",
        lastScanAt: expect.any(Date),
      },
    });
  });

  it("advances the Gmail history cursor after a successful auto-import", async () => {
    mocks.recordLifecycle.mockResolvedValueOnce(undefined);

    const result = await scanUserInbox("owner-1");

    expect(result.autoImported).toBe(1);
    expect(mocks.scannedDelete).not.toHaveBeenCalled();
    expect(mocks.integrationUpdate).toHaveBeenCalledWith({
      where: { userId: "owner-1" },
      data: {
        lastHistoryId: "history-new",
        lastScanAt: expect.any(Date),
      },
    });
  });

  it("creates a new interview application through the atomic lifecycle workflow", async () => {
    mocks.applicationFind.mockResolvedValueOnce(null);

    await scanUserInbox("owner-1");

    expect(mocks.createLifecycle).toHaveBeenCalledWith({
      userId: "owner-1",
      company: "Acme",
      role: "Engineer",
      status: "interview",
      occurredAt: receivedAt,
      scannedEmailId: 7,
    });
    expect(mocks.scannedUpdate).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { applicationId: 42, status: "imported" },
    });
  });
});
