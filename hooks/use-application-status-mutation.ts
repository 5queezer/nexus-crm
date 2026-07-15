"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import type { Application, ApplicationStatus } from "@/types";

async function patchApplicationStatus({
	id,
	status,
}: {
	id: string;
	status: ApplicationStatus;
}): Promise<Application> {
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
	const latestMutationByApplication = useRef(new Map<string, symbol>());
	return useMutation({
		mutationFn: patchApplicationStatus,
		onMutate: async ({ id, status }) => {
			await queryClient.cancelQueries({ queryKey: ["applications"] });
			const token = Symbol(id);
			latestMutationByApplication.current.set(id, token);
			const previousApplication = queryClient
				.getQueryData<Application[]>(["applications"])
				?.find((application) => application.id === id);
			queryClient.setQueryData<Application[]>(["applications"], (current) =>
				(current ?? []).map((application) =>
					application.id === id ? { ...application, status } : application,
				),
			);
			return { previousApplication, token };
		},
		onSuccess: (updated, variables, context) => {
			if (
				latestMutationByApplication.current.get(variables.id) !== context.token
			) {
				return;
			}
			queryClient.setQueryData<Application[]>(["applications"], (current) =>
				(current ?? []).map((application) =>
					application.id === updated.id ? updated : application,
				),
			);
		},
		onError: (_error, variables, context) => {
			const isLatest =
				context &&
				latestMutationByApplication.current.get(variables.id) === context.token;
			const previousApplication = context?.previousApplication;
			if (isLatest && previousApplication) {
				queryClient.setQueryData<Application[]>(["applications"], (current) =>
					(current ?? []).map((application) =>
						application.id === variables.id ? previousApplication : application,
					),
				);
			}
			options?.onRollback?.();
		},
		onSettled: (_data, _error, variables, context) => {
			if (
				context &&
				latestMutationByApplication.current.get(variables.id) === context.token
			) {
				latestMutationByApplication.current.delete(variables.id);
				void queryClient.invalidateQueries({ queryKey: ["applications"] });
			}
		},
	});
}
