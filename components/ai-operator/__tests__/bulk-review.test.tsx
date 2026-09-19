// @vitest-environment jsdom

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BulkReview } from "../bulk-review";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import messages from "@/messages/en.json";
import germanMessages from "@/messages/de.json";

const command = {
	id: "command-1",
	threadId: "thread-1",
	runId: "run-1",
	actionType: "reschedule_follow_up",
	status: "preview",
	digest: "a".repeat(64),
	scope: { mode: "selected", applicationIds: ["application-1", "application-2"] },
	reason: "Move overdue follow-ups",
	exclusions: [],
	requestHash: "hash",
	idempotencyKey: "idempotency",
	expiresAt: "2026-09-20T00:00:00.000Z",
	approvedDigest: null,
	approvedAt: null,
	startedAt: null,
	completedAt: null,
	pauseRequestedAt: null,
	cancelRequestedAt: null,
	undoRequestedAt: null,
	createdAt: "2026-09-19T00:00:00.000Z",
	updatedAt: "2026-09-19T00:00:00.000Z",
	targetCount: 2,
	reversible: true,
	supersedesId: null,
	counts: { total: 2, pending: 2, running: 0, applied: 0, skipped: 0, failed: 0, stale: 0, cancelled: 0, outcome_unknown: 0, undoPending: 0, undoApplied: 0, undoStale: 0, undoFailed: 0 },
	items: [
		{ id: "item-1", commandId: "command-1", applicationId: "application-1", company: "Acme", role: "Engineer", ordinal: 0, expectedVersion: 3, before: { followUpAt: "2026-09-18T09:00:00.000Z" }, after: { followUpAt: "2026-09-21T09:00:00.000Z" }, reason: "Overdue", evidence: null, idempotencyKey: "item-key-1", status: "pending", attempts: 0, errorCode: null, errorMessage: null, appliedVersion: null, appliedBefore: null, appliedAfter: null, appliedAt: null, verifiedAt: null, undoStatus: null, undoExpectedVersion: null, undoAppliedAt: null, createdAt: "2026-09-19T00:00:00.000Z", updatedAt: "2026-09-19T00:00:00.000Z" },
		{ id: "item-2", commandId: "command-1", applicationId: "application-2", company: "Beta", role: "Designer", ordinal: 1, expectedVersion: 7, before: { followUpAt: null }, after: { followUpAt: "2026-09-21T10:00:00.000Z" }, reason: "Needs date", evidence: null, idempotencyKey: "item-key-2", status: "pending", attempts: 0, errorCode: null, errorMessage: null, appliedVersion: null, appliedBefore: null, appliedAfter: null, appliedAt: null, verifiedAt: null, undoStatus: null, undoExpectedVersion: null, undoAppliedAt: null, createdAt: "2026-09-19T00:00:00.000Z", updatedAt: "2026-09-19T00:00:00.000Z" },
	],
};

function response(value: unknown, status = 200) {
	return Promise.resolve(new Response(JSON.stringify(value), {
		status,
		headers: { "Content-Type": "application/json" },
	}));
}

function renderReview(locale = "en", localizedMessages: typeof messages = messages) {
	return render(
		<QueryClientProvider client={new QueryClient()}>
			<NextIntlClientProvider locale={locale} messages={localizedMessages}>
				<BulkReview commandId="command-1" />
			</NextIntlClientProvider>
		</QueryClientProvider>,
	);
}

describe("BulkReview", () => {
	beforeEach(() => vi.restoreAllMocks());

	it("shows the exact frozen targets and binds approval to id plus digest", async () => {
		let approvalBody: unknown;
		vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
			const url = String(input);
			if (url.endsWith("/api/agent/bulk/command-1") && !init?.method)
				return response({ command });
			if (url.endsWith("/api/agent/bulk/command-1/approve")) {
				approvalBody = JSON.parse(String(init?.body));
				return response({ command: { ...command, status: "approved", approvedDigest: command.digest } });
			}
			return response({ error: "not found" }, 404);
		});
		const user = userEvent.setup();
		renderReview();

		expect((await screen.findAllByText("Acme")).length).toBeGreaterThan(0);
		expect(screen.getAllByText("Beta").length).toBeGreaterThan(0);
		expect(screen.getByText("2 exact targets")).toBeTruthy();
		await user.click(screen.getByRole("button", { name: "Approve exact plan" }));

		await waitFor(() => expect(approvalBody).toEqual({ digest: command.digest }));
	});

	it("creates a new preview before approval when a row is excluded", async () => {
		let revisionBody: unknown;
		vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
			const url = String(input);
			if (url.endsWith("/api/agent/bulk/command-1") && !init?.method)
				return response({ command });
			if (url.endsWith("/api/agent/bulk/previews/command-1/revisions")) {
				revisionBody = JSON.parse(String(init?.body));
				return response({ command: { ...command, id: "command-2", digest: "b".repeat(64), targetCount: 1, items: [command.items[0]], supersedesId: "command-1" } });
			}
			return response({ error: "not found" }, 404);
		});
		const user = userEvent.setup();
		renderReview();
		const betaRow = await screen.findByRole("row", { name: /Beta/ });
		await user.click(within(betaRow).getByRole("checkbox"));
		await user.click(screen.getByRole("button", { name: "Update preview" }));

		await waitFor(() =>
			expect(revisionBody).toEqual({
				digest: command.digest,
				excludedApplicationIds: ["application-2"],
			}),
		);
		expect(await screen.findByText("1 exact target")).toBeTruthy();
	});

	it("localizes known statuses, outcomes, controls, and calendar dates", async () => {
		vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
			const url = String(input);
			if (url.endsWith("/api/agent/bulk/command-1") && !init?.method)
				return response({ command });
			return response({ error: "not found" }, 404);
		});

		renderReview("de", germanMessages);

		expect(await screen.findByLabelText("Sammeländerung prüfen")).toBeTruthy();
		expect(screen.getByText("2 genaue Ziele")).toBeTruthy();
		expect(screen.getByText("Bereit zur Prüfung")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Genauen Plan genehmigen" })).toBeTruthy();
		expect(screen.getAllByText("18.09.2026").length).toBeGreaterThan(0);
	});
});
