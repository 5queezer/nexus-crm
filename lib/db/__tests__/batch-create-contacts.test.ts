import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { FirestoreAdapter } from "../firestore-adapter";
import { PrismaAdapter } from "../prisma-adapter";
import type { ContactRecord, CreateContactInput } from "../types";

const contacts: CreateContactInput[] = [
  { name: "Recruiter", email: null, phone: null, role: null, linkedIn: null },
  { name: "Hiring Manager", email: null, phone: null, role: null, linkedIn: null },
];

const created: ContactRecord = {
  id: "contact-1",
  applicationId: "app-1",
  name: "Recruiter",
  email: null,
  phone: null,
  role: null,
  linkedIn: null,
  createdAt: new Date("2026-08-19T00:00:00.000Z"),
};

describe.each([
  ["Prisma", PrismaAdapter],
  ["Firestore", FirestoreAdapter],
])("%s batchCreateContacts", (_name, Adapter) => {
  it("creates items independently and reports partial success", async () => {
    const adapter = Object.create(Adapter.prototype) as InstanceType<typeof Adapter>;
    vi.spyOn(adapter, "createContact")
      .mockResolvedValueOnce(created)
      .mockRejectedValueOnce(new Error("write_failed"));

    const result = await adapter.batchCreateContacts("app-1", "owner-1", contacts);

    expect(adapter.createContact).toHaveBeenNthCalledWith(1, "app-1", "owner-1", contacts[0]);
    expect(adapter.createContact).toHaveBeenNthCalledWith(2, "app-1", "owner-1", contacts[1]);
    expect(result).toEqual({
      total: 2,
      succeeded: 1,
      failed: 1,
      results: [
        { index: 0, id: "contact-1", operation: "created" },
        { index: 1, id: "", operation: "created", error: "write_failed" },
      ],
    });
  });
});
