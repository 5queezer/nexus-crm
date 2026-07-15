// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Application, ApplicationStatus } from "@/types";
import { useApplicationStatusMutation } from "../use-application-status-mutation";

function application(id: string, status: ApplicationStatus): Application {
	return {
		id,
		company: id,
		role: "Role",
		status,
		appliedAt: null,
		lastContact: null,
		followUpAt: null,
		notes: null,
		jobDescription: null,
		source: null,
		remote: false,
		salaryMin: null,
		salaryMax: null,
		rating: null,
		jobUrl: null,
		resumeId: null,
		companySize: null,
		salaryBandMentioned: false,
		triageQuality: null,
		triageReason: null,
		incomingSource: null,
		autoRejected: false,
		autoRejectReason: null,
		archivedAt: null,
		createdAt: "2026-07-01T00:00:00.000Z",
		updatedAt: "2026-07-01T00:00:00.000Z",
	};
}

interface MutationHandle {
	current?: (variables: {
		id: string;
		status: ApplicationStatus;
	}) => Promise<Application>;
}

function Harness({ mutationHandleRef }: { mutationHandleRef: MutationHandle }) {
	const { mutateAsync } = useApplicationStatusMutation();
	useEffect(() => {
		mutationHandleRef.current = mutateAsync;
	}, [mutateAsync, mutationHandleRef]);
	return null;
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

describe("useApplicationStatusMutation concurrency", () => {
	let container: HTMLDivElement;
	let root: Root;
	let queryClient: QueryClient;
	let mutationHandleRef: MutationHandle;

	beforeEach(() => {
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
		queryClient = new QueryClient({
			defaultOptions: {
				mutations: { retry: false },
				queries: { retry: false },
			},
		});
		queryClient.setQueryData<Application[]>(
			["applications"],
			[application("a", "inbound"), application("b", "inbound")],
		);

		mutationHandleRef = {};
		act(() => {
			root.render(
				<QueryClientProvider client={queryClient}>
					<Harness mutationHandleRef={mutationHandleRef} />
				</QueryClientProvider>,
			);
		});
	});

	afterEach(async () => {
		vi.unstubAllGlobals();
		await act(async () => root.unmount());
		document.body.replaceChildren();
	});

	it("rolls back only the failed application without clobbering a concurrent success", async () => {
		const firstRequest = deferred<Response>();
		const successfulB = application("b", "interview");
		const fetchMock = vi
			.fn()
			.mockReturnValueOnce(firstRequest.promise)
			.mockResolvedValueOnce({
				ok: true,
				json: async () => successfulB,
			} as Response);
		vi.stubGlobal("fetch", fetchMock);

		let failedMutation!: Promise<Application | undefined>;
		await act(async () => {
			failedMutation = mutationHandleRef.current!({
				id: "a",
				status: "applied",
			}).catch(() => undefined);
			await Promise.resolve();
		});

		await act(async () => {
			await mutationHandleRef.current!({ id: "b", status: "interview" });
		});
		expect(
			queryClient
				.getQueryData<Application[]>(["applications"])
				?.map((item) => [item.id, item.status]),
		).toEqual([
			["a", "applied"],
			["b", "interview"],
		]);

		await act(async () => {
			firstRequest.reject(new Error("request failed"));
			await failedMutation;
		});

		expect(
			queryClient
				.getQueryData<Application[]>(["applications"])
				?.map((item) => [item.id, item.status]),
		).toEqual([
			["a", "inbound"],
			["b", "interview"],
		]);
	});
});
