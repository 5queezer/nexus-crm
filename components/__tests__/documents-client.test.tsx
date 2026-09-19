// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../messages/en.json";

vi.mock("../app-header", () => ({ AppHeader: () => <header>Header</header> }));

import { DocumentsClient } from "../documents-client";

const owner = { email: "owner@example.com", name: "Owner", image: null };
const documents = [
  {
    id: "doc-1",
    filename: "stored-1.pdf",
    originalName: "Resume — Northstar.pdf",
    size: 188_416,
    mimeType: "application/pdf",
    documentType: "other",
    state: "current",
    version: 2,
    submissionId: null,
    uploadedAt: "2026-09-17T10:00:00.000Z",
    applications: [{ id: "app-1", company: "Northstar", role: "Engineer" }],
  },
  {
    id: "doc-2",
    filename: "stored-2.pdf",
    originalName: "Cover letter.pdf",
    size: 42_000,
    mimeType: "application/pdf",
    documentType: "cover_letter",
    state: "current",
    version: 1,
    submissionId: null,
    uploadedAt: "2026-09-18T10:00:00.000Z",
    applications: [],
  },
];

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

function renderDocuments() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <QueryClientProvider client={queryClient}>
        <DocumentsClient user={owner} />
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );
}

describe("DocumentsClient", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("searches and filters the collection while keeping selected document details visible", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/documents") return json(documents);
      if (url === "/api/share-links") return json({ links: [] });
      if (url === "/api/applications") return json([{ id: "app-1", company: "Northstar", role: "Engineer" }]);
      return json({ error: "unexpected" }, 500);
    });
    const user = userEvent.setup();
    renderDocuments();

    expect(await screen.findByRole("heading", { name: "Documents" })).toBeTruthy();
    expect((await screen.findByRole("complementary", { name: "Selected document" })).textContent).toContain("Resume — Northstar.pdf");
    expect(screen.getByRole("link", { name: /Northstar — Engineer/ }).getAttribute("href")).toBe("/applications/app-1");

    await user.click(screen.getByRole("button", { name: "Unlinked" }));
    expect(screen.queryByRole("button", { name: /Resume — Northstar/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Cover letter.pdf/ })).toBeTruthy();

    await user.type(screen.getByRole("searchbox", { name: "Search documents" }), "northstar");
    expect(screen.getByText("No documents match your search and filters.")).toBeTruthy();
  });

  it("rejects unsupported uploads before making a document request", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/documents") return json([]);
      if (url === "/api/share-links") return json({ links: [] });
      if (url === "/api/applications") return json([]);
      return json({ error: "unexpected" }, 500);
    });
    const user = userEvent.setup({ applyAccept: false });
    renderDocuments();

    const input = await screen.findByLabelText("Upload documents");
    await user.upload(input, new File(["plain text"], "notes.txt", { type: "text/plain" }));
    expect((await screen.findByRole("alert")).textContent).toContain("notes.txt: unsupported file type");
    expect(fetchMock.mock.calls.filter(([url, init]) => String(url) === "/api/documents" && init?.method === "POST")).toHaveLength(0);
  });

  it("creates and revokes a real document share link", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/documents") return json(documents);
      if (url === "/api/applications") return json([]);
      if (url === "/api/share-links" && !init?.method) return json({ links: [] });
      if (url === "/api/share-links" && init?.method === "POST") return json({ id: "link-1", code: "real-code", targetType: "document", targetId: "doc-1" }, 201);
      if (url === "/api/share-links" && init?.method === "DELETE") return new Response(null, { status: 204 });
      return json({ error: "unexpected" }, 500);
    });
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    renderDocuments();

    await screen.findByText("Private · Only you");
    await user.click(screen.getByRole("button", { name: "Create share link" }));
    expect(await screen.findByText("Shared by link")).toBeTruthy();
    expect(writeText).toHaveBeenCalledWith("http://localhost:3000/s/real-code");

    await user.click(screen.getByRole("button", { name: "Revoke share link" }));
    await waitFor(() => expect(screen.getByText("Private · Only you")).toBeTruthy());
    const revoke = fetchMock.mock.calls.find(([url, init]) => String(url) === "/api/share-links" && init?.method === "DELETE");
    expect(revoke?.[1]?.body).toBe(JSON.stringify({ id: "link-1" }));
  });

  it("adds a linked opportunity without dropping existing links or version metadata", async () => {
    const updated = {
      ...documents[0],
      applications: [...documents[0].applications, { id: "app-2", company: "Aster", role: "Platform Engineer" }],
    };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/documents" && !init?.method) return json(documents);
      if (url === "/api/share-links") return json({ links: [] });
      if (url === "/api/applications") return json([
        { id: "app-1", company: "Northstar", role: "Engineer" },
        { id: "app-2", company: "Aster", role: "Platform Engineer" },
      ]);
      if (url === "/api/documents/doc-1" && init?.method === "PATCH") return json(updated);
      return json({ error: "unexpected" }, 500);
    });
    const user = userEvent.setup();
    renderDocuments();

    await screen.findByRole("complementary", { name: "Selected document" });
    await user.selectOptions(screen.getByRole("combobox", { name: "Link opportunity" }), "app-2");
    await user.click(screen.getByRole("button", { name: "Add opportunity link" }));

    await screen.findByRole("link", { name: "Aster — Platform Engineer" });
    const update = fetchMock.mock.calls.find(([url, init]) => String(url) === "/api/documents/doc-1" && init?.method === "PATCH");
    expect(update?.[1]?.body).toBe(JSON.stringify({ applicationIds: ["app-1", "app-2"] }));
    expect(screen.getByText("2", { selector: "dd" })).toBeTruthy();
  });
});
