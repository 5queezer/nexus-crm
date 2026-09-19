import { describe, expect, it, vi } from "vitest";
import {
  queryOwnerAnalytics,
  queryOwnerDocuments,
  queryOwnerEmailReview,
  type DomainQueryDependencies,
} from "../domain-queries";

function analyticsApplication(id: string, status = "rejected") {
  return {
    id,
    company: `Company ${id}`,
    role: "Engineer",
    status,
    source: "linkedin",
    archivedAt: null,
    createdAt: new Date("2026-08-10T12:00:00Z"),
  };
}

describe("owner-scoped assistant domain queries", () => {
  it("returns actual analytics evidence with explicit coverage and no status-derived reply", async () => {
    const listApplications = vi.fn().mockResolvedValue([
      analyticsApplication("1"),
      analyticsApplication("2", "interview"),
    ]);
    const listApplicationEventsFiltered = vi.fn()
      .mockResolvedValueOnce({
        items: [
          { id: "e1", applicationId: "1", type: "application_submitted", occurredAt: new Date("2026-08-11T12:00:00Z"), metadata: {} },
          { id: "e2", applicationId: "2", type: "outbound_contact_recorded", occurredAt: new Date("2026-08-11T12:00:00Z"), metadata: {} },
          { id: "e3", applicationId: "2", type: "reply_received", occurredAt: new Date("2026-08-12T12:00:00Z"), metadata: { responseKind: "human", replyDateKnown: false } },
        ],
        nextCursor: null,
      });
    const deps = { db: { listApplications, listApplicationEventsFiltered } } as unknown as DomainQueryDependencies;

    const result = await queryOwnerAnalytics("owner-1", {
      start: "2026-08-01",
      end: "2026-08-31",
      cutoff: new Date("2026-09-19T12:00:00Z"),
      includeArchived: true,
    }, deps);

    expect(listApplications).toHaveBeenCalledWith("owner-1");
    expect(listApplicationEventsFiltered).toHaveBeenCalledWith("owner-1", expect.objectContaining({ limit: 100 }));
    expect(result).toMatchObject({
      filters: { start: "2026-08-01", end: "2026-08-31", includeArchived: true, timeZone: "UTC" },
      cohort: { total: 2, contacted: 2 },
      replyRate: { numerator: 1, denominator: 2, percentage: 50 },
      coverage: { confirmedReplies: 1, datedReplies: 0, undatedReplies: 1, pendingReplies: 1 },
    });
    expect(result.replyRate).not.toHaveProperty("recordIds");
    expect(result).not.toHaveProperty("records");
  });

  it("uses an explicit timezone for assistant cohort dates and reply durations", async () => {
    const listApplications = vi.fn().mockResolvedValue([
      { ...analyticsApplication("included"), createdAt: new Date("2026-07-31T20:00:00Z") },
    ]);
    const listApplicationEventsFiltered = vi.fn().mockResolvedValue({
      items: [
        { id: "e1", applicationId: "included", type: "outbound_contact_recorded", occurredAt: new Date("2026-08-01T18:20:00Z"), metadata: {} },
        { id: "e2", applicationId: "included", type: "reply_received", occurredAt: new Date("2026-08-01T18:40:00Z"), metadata: { responseKind: "human" } },
      ],
      nextCursor: null,
    });
    const deps = { db: { listApplications, listApplicationEventsFiltered } } as unknown as DomainQueryDependencies;

    const result = await queryOwnerAnalytics("owner-1", {
      start: "2026-08-01",
      end: "2026-08-02",
      cutoff: new Date("2026-09-19T12:00:00Z"),
      timeZone: "Asia/Kolkata",
    }, deps);

    expect(result).toMatchObject({
      filters: { timeZone: "Asia/Kolkata" },
      cohort: { total: 1 },
      medianFirstReplyDays: { value: 1, sampleCount: 1 },
    });
  });

  it("returns bounded owner document metadata with explicit truncation", async () => {
    const listDocuments = vi.fn().mockResolvedValue([
      { id: "1", userId: "owner-1", filename: "secret-a", originalName: "Resume.pdf", size: 100, mimeType: "application/pdf", documentType: "resume", state: "current", version: 1, source: "upload", uploadedAt: new Date("2026-09-03T12:00:00Z"), applicationIds: ["a1"] },
      { id: "2", userId: "owner-1", filename: "secret-b", originalName: "Cover.pdf", size: 200, mimeType: "application/pdf", documentType: "cover_letter", state: "current", version: 1, source: "generated", uploadedAt: new Date("2026-09-02T12:00:00Z"), applicationIds: [] },
      { id: "3", userId: "owner-1", filename: "secret-c", originalName: "Notes.txt", size: 50, mimeType: "text/plain", documentType: "other", state: "current", version: 1, source: "upload", uploadedAt: new Date("2026-09-01T12:00:00Z"), applicationIds: [] },
    ]);
    const deps = { db: { listDocuments } } as unknown as DomainQueryDependencies;

    const result = await queryOwnerDocuments("owner-1", { limit: 2 }, deps);

    expect(listDocuments).toHaveBeenCalledWith("owner-1");
    expect(result).toMatchObject({
      totalCount: 3,
      returnedCount: 2,
      limit: 2,
      truncated: true,
      contentTrust: "untrusted_user_metadata",
    });
    expect(result.items.map((item) => item.originalName)).toEqual(["Resume.pdf", "Cover.pdf"]);
    expect(result.items[0]).not.toHaveProperty("filename");
    expect(result.items[0]).not.toHaveProperty("userId");
  });

  it("returns bounded owner email-review metadata without provider IDs or extracted content", async () => {
    const count = vi.fn().mockResolvedValue(3);
    const findMany = vi.fn().mockResolvedValue([
      {
        id: 3,
        userId: "owner-1",
        messageId: "provider-secret",
        subject: "Interview request",
        sender: "recruiter@example.com",
        receivedAt: new Date("2026-09-03T12:00:00Z"),
        classification: "interview",
        confidence: "high",
        extractedData: '{"body":"untrusted"}',
        status: "pending",
        applicationId: null,
        createdAt: new Date("2026-09-03T12:01:00Z"),
      },
    ]);
    const deps = { emailReview: { count, findMany } } as unknown as DomainQueryDependencies;

    const result = await queryOwnerEmailReview("owner-1", { status: "pending", limit: 1 }, deps);

    expect(count).toHaveBeenCalledWith({ where: { userId: "owner-1", status: "pending" } });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: "owner-1", status: "pending" },
      take: 1,
    }));
    expect(result).toMatchObject({
      totalCount: 3,
      returnedCount: 1,
      limit: 1,
      truncated: true,
      contentTrust: "untrusted_external_metadata",
    });
    expect(result.items[0]).toMatchObject({ id: "3", subject: "Interview request", status: "pending" });
    expect(result.items[0]).not.toHaveProperty("messageId");
    expect(result.items[0]).not.toHaveProperty("extractedData");
    expect(result.items[0]).not.toHaveProperty("userId");
  });

  it("rejects missing owner identity before any read", async () => {
    const listDocuments = vi.fn();
    const deps = { db: { listDocuments } } as unknown as DomainQueryDependencies;

    await expect(queryOwnerDocuments("", {}, deps)).rejects.toThrow("owner_user_id_required");
    expect(listDocuments).not.toHaveBeenCalled();
  });

  it("caps output limits and rejects unsupported email review states", async () => {
    const listDocuments = vi.fn().mockResolvedValue([]);
    const count = vi.fn();
    const findMany = vi.fn();
    const deps = {
      db: { listDocuments },
      emailReview: { count, findMany },
    } as unknown as DomainQueryDependencies;

    await expect(queryOwnerDocuments("owner-1", { limit: 500 }, deps)).resolves.toMatchObject({ limit: 50 });
    await expect(queryOwnerEmailReview("owner-1", { status: "deleted" as "pending" }, deps))
      .rejects.toThrow("email_review_status_invalid");
    expect(count).not.toHaveBeenCalled();
    expect(findMany).not.toHaveBeenCalled();
  });
});
