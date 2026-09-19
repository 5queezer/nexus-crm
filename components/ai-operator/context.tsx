"use client";

import {
	createContext,
	useContext,
	useLayoutEffect,
	useMemo,
	useState,
	type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import {
	assistantContextUpdateSchema,
	DEFAULT_ASSISTANT_CONTEXT,
	mergeAssistantContext,
	type AssistantContext,
	type AssistantContextUpdate,
} from "@/lib/assistant/context";

export const ASSISTANT_CONTEXT_EVENT = "nexus:assistant-context";
export const ASSISTANT_OPEN_EVENT = "nexus:assistant-open";
export const ASSISTANT_CAPABILITY_EVENT = "nexus:assistant-capability";
export const BULK_REVIEW_EVENT = "nexus:bulk-review";
export const ASSISTANT_TASK_STATE_EVENT = "nexus:assistant-task-state";
export const ASSISTANT_TASK_STATE_REQUEST_EVENT =
	"nexus:assistant-task-state-request";

const AssistantPageContext = createContext<AssistantContext>(
	DEFAULT_ASSISTANT_CONTEXT,
);

export function AssistantContextProvider({ children }: { children: ReactNode }) {
	const pathname = usePathname();
	const [context, setContext] = useState<AssistantContext>(() => ({
		...DEFAULT_ASSISTANT_CONTEXT,
		route: typeof window === "undefined" ? "/" : window.location.pathname,
		timeZone:
			typeof window === "undefined"
				? "UTC"
				: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
	}));

	useLayoutEffect(() => {
		const update = (event: Event) => {
			const parsed = assistantContextUpdateSchema.safeParse(
				(event as CustomEvent<unknown>).detail,
			);
			if (!parsed.success) return;
			setContext((current) => {
				const routed =
					pathname && pathname !== current.route
						? mergeAssistantContext(current, { route: pathname })
						: current;
				return mergeAssistantContext(routed, parsed.data);
			});
		};
		window.addEventListener(ASSISTANT_CONTEXT_EVENT, update);
		return () => window.removeEventListener(ASSISTANT_CONTEXT_EVENT, update);
	}, [pathname]);

	const value = useMemo(
		() =>
			pathname && pathname !== context.route
				? mergeAssistantContext(context, { route: pathname })
				: context,
		[context, pathname],
	);
	return (
		<AssistantPageContext.Provider value={value}>
			{children}
		</AssistantPageContext.Provider>
	);
}

export function useAssistantContext(): AssistantContext {
	return useContext(AssistantPageContext);
}

export function publishAssistantContext(update: AssistantContextUpdate) {
	if (typeof window === "undefined") return;
	const parsed = assistantContextUpdateSchema.safeParse(update);
	if (!parsed.success) return;
	window.dispatchEvent(
		new CustomEvent(ASSISTANT_CONTEXT_EVENT, { detail: parsed.data }),
	);
}
