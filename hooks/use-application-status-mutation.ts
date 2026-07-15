"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import type { Application, ApplicationStatus } from "@/types";

export interface ApplicationStatusVariables {
  id: string;
  status: ApplicationStatus;
}

interface PendingStatusState {
  latestToken: symbol;
  confirmedStatus?: ApplicationStatus;
}

interface StatusMutationContext {
  token: symbol;
}

async function patchApplicationStatus({
  id,
  status,
}: ApplicationStatusVariables): Promise<Application> {
  const response = await fetch(`/api/applications/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  if (!response.ok) throw new Error("Failed to update status");
  return response.json();
}

export function useApplicationStatusMutation(options?: {
  onRollback?: () => void;
}) {
  const queryClient = useQueryClient();
  const pendingByApplication = useRef(new Map<string, PendingStatusState>());
  const writeTailByApplication = useRef(new Map<string, Promise<void>>());

  async function serializeStatusWrite(
    variables: ApplicationStatusVariables,
  ): Promise<Application> {
    const previousWrite =
      writeTailByApplication.current.get(variables.id) ?? Promise.resolve();
    const request = previousWrite.catch(() => undefined).then(async () => {
      const updated = await patchApplicationStatus(variables);
      const pending = pendingByApplication.current.get(variables.id);
      if (pending) pending.confirmedStatus = updated.status;
      return updated;
    });
    const tail = request.then(
      () => undefined,
      () => undefined,
    );
    writeTailByApplication.current.set(variables.id, tail);

    try {
      return await request;
    } finally {
      if (writeTailByApplication.current.get(variables.id) === tail) {
        writeTailByApplication.current.delete(variables.id);
      }
    }
  }

  return useMutation<
    Application,
    Error,
    ApplicationStatusVariables,
    StatusMutationContext
  >({
    mutationFn: serializeStatusWrite,
    onMutate: async ({ id, status }: ApplicationStatusVariables) => {
      await queryClient.cancelQueries({ queryKey: ["applications"] });
      const token = Symbol(id);
      const currentApplications = queryClient.getQueryData<Application[]>([
        "applications",
      ]);
      const currentPending = pendingByApplication.current.get(id);
      if (currentPending) {
        currentPending.latestToken = token;
      } else {
        pendingByApplication.current.set(id, {
          latestToken: token,
          confirmedStatus: currentApplications?.find(
            (application: Application) => application.id === id,
          )?.status,
        });
      }
      queryClient.setQueryData<Application[]>(
        ["applications"],
        (current: Application[] | undefined) =>
          (current ?? []).map((application: Application) =>
            application.id === id ? { ...application, status } : application,
          ),
      );
      return { token };
    },
    onSuccess: (
      updated: Application,
      variables: ApplicationStatusVariables,
      context: StatusMutationContext,
    ) => {
      const pending = pendingByApplication.current.get(variables.id);
      if (!pending || pending.latestToken !== context.token) return;
      queryClient.setQueryData<Application[]>(
        ["applications"],
        (current: Application[] | undefined) =>
          (current ?? []).map((application: Application) =>
            application.id === updated.id
              ? { ...application, status: updated.status }
              : application,
          ),
      );
    },
    onError: (
      _error: Error,
      variables: ApplicationStatusVariables,
      context: StatusMutationContext | undefined,
    ) => {
      const pending = pendingByApplication.current.get(variables.id);
      if (!pending || pending.latestToken !== context?.token) return;

      const confirmedStatus = pending.confirmedStatus;
      if (confirmedStatus !== undefined) {
        queryClient.setQueryData<Application[]>(
          ["applications"],
          (current: Application[] | undefined) =>
            (current ?? []).map((application: Application) =>
              application.id === variables.id
                ? { ...application, status: confirmedStatus }
                : application,
            ),
        );
      }
      options?.onRollback?.();
    },
    onSettled: (
      _data: Application | undefined,
      _error: Error | null,
      variables: ApplicationStatusVariables,
      context: StatusMutationContext | undefined,
    ) => {
      const pending = pendingByApplication.current.get(variables.id);
      if (pending?.latestToken === context?.token) {
        pendingByApplication.current.delete(variables.id);
        void queryClient.invalidateQueries({ queryKey: ["applications"] });
      }
    },
  });
}

export type ApplicationStatusMutation = Pick<
  ReturnType<typeof useApplicationStatusMutation>,
  "mutate"
>;
