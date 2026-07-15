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

function MutationConsumer({
  mutateAsync,
  mutationHandleRef,
}: {
  mutateAsync: NonNullable<MutationHandle["current"]>;
  mutationHandleRef: MutationHandle;
}) {
  useEffect(() => {
    mutationHandleRef.current = mutateAsync;
  }, [mutateAsync, mutationHandleRef]);
  return null;
}

function Harness({
  mutationHandleRef,
  consumerKey = "focus",
}: {
  mutationHandleRef: MutationHandle;
  consumerKey?: string;
}) {
  const { mutateAsync } = useApplicationStatusMutation();
  return (
    <MutationConsumer
      key={consumerKey}
      mutateAsync={mutateAsync}
      mutationHandleRef={mutationHandleRef}
    />
  );
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

  it("keeps same-application writes serialized when the status consumer switches views", async () => {
    const firstRequest = deferred<Response>();
    const secondRequest = deferred<Response>();
    let serverStatus: ApplicationStatus = "inbound";
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(firstRequest.promise)
      .mockReturnValueOnce(secondRequest.promise);
    vi.stubGlobal("fetch", fetchMock);

    let firstMutation!: Promise<Application>;
    let secondMutation!: Promise<Application>;
    await act(async () => {
      firstMutation = mutationHandleRef.current!({
        id: "a",
        status: "applied",
      });
      await Promise.resolve();
    });

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Harness
            mutationHandleRef={mutationHandleRef}
            consumerKey="stages"
          />
        </QueryClientProvider>,
      );
    });

    await act(async () => {
      secondMutation = mutationHandleRef.current!({
        id: "a",
        status: "interview",
      });
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      queryClient
        .getQueryData<Application[]>(["applications"])
        ?.find((item) => item.id === "a")?.status,
    ).toBe("interview");

    await act(async () => {
      serverStatus = "applied";
      firstRequest.resolve({
        ok: true,
        json: async () => application("a", serverStatus),
      } as Response);
      await firstMutation;
    });

    expect(serverStatus).toBe("applied");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      fetchMock.mock.calls.map(([, init]) =>
        JSON.parse((init as RequestInit).body as string),
      ),
    ).toEqual([{ status: "applied" }, { status: "interview" }]);

    await act(async () => {
      serverStatus = "interview";
      secondRequest.resolve({
        ok: true,
        json: async () => application("a", serverStatus),
      } as Response);
      await secondMutation;
    });

    expect(serverStatus).toBe("interview");
    expect(
      queryClient
        .getQueryData<Application[]>(["applications"])
        ?.find((item) => item.id === "a")?.status,
    ).toBe("interview");
  });

  it("does not let an older failed write roll back a newer pending intent", async () => {
    const firstRequest = deferred<Response>();
    const secondRequest = deferred<Response>();
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(firstRequest.promise)
      .mockReturnValueOnce(secondRequest.promise);
    vi.stubGlobal("fetch", fetchMock);

    let firstMutation!: Promise<Application | undefined>;
    let secondMutation!: Promise<Application>;
    await act(async () => {
      firstMutation = mutationHandleRef
        .current!({ id: "a", status: "applied" })
        .catch(() => undefined);
      secondMutation = mutationHandleRef.current!({
        id: "a",
        status: "interview",
      });
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      queryClient
        .getQueryData<Application[]>(["applications"])
        ?.find((item) => item.id === "a")?.status,
    ).toBe("interview");

    await act(async () => {
      firstRequest.reject(new Error("older write failed"));
      await firstMutation;
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      queryClient
        .getQueryData<Application[]>(["applications"])
        ?.find((item) => item.id === "a")?.status,
    ).toBe("interview");
    expect(
      fetchMock.mock.calls.map(([, init]) =>
        JSON.parse((init as RequestInit).body as string),
      ),
    ).toEqual([{ status: "applied" }, { status: "interview" }]);

    await act(async () => {
      secondRequest.resolve({
        ok: true,
        json: async () => application("a", "interview"),
      } as Response);
      await secondMutation;
    });

    expect(
      queryClient
        .getQueryData<Application[]>(["applications"])
        ?.find((item) => item.id === "a")?.status,
    ).toBe("interview");
  });

  it("rolls a failed final same-application write back to the last confirmed write", async () => {
    const firstRequest = deferred<Response>();
    const secondRequest = deferred<Response>();
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(firstRequest.promise)
      .mockReturnValueOnce(secondRequest.promise);
    vi.stubGlobal("fetch", fetchMock);

    let firstMutation!: Promise<Application>;
    let secondMutation!: Promise<Application | undefined>;
    await act(async () => {
      firstMutation = mutationHandleRef.current!({
        id: "a",
        status: "applied",
      });
      secondMutation = mutationHandleRef
        .current!({ id: "a", status: "interview" })
        .catch(() => undefined);
      await Promise.resolve();
    });

    await act(async () => {
      firstRequest.resolve({
        ok: true,
        json: async () => application("a", "applied"),
      } as Response);
      await firstMutation;
    });

    await act(async () => {
      secondRequest.reject(new Error("request failed"));
      await secondMutation;
    });

    expect(
      queryClient
        .getQueryData<Application[]>(["applications"])
        ?.find((item) => item.id === "a")?.status,
    ).toBe("applied");
  });

  it("keeps different-application writes concurrent and rolls back independently", async () => {
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
