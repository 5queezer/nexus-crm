"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { AiOperator } from "@/components/ai-operator/ai-operator";
import { AssistantContextProvider } from "@/components/ai-operator/context";
import { HistoryNavigationGuard } from "@/components/history-navigation-guard";

export function Providers({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const workspace = pathname === "/" || /^\/(applications|activity|documents|analytics|settings|resume-review|tasks)(\/|$)/.test(pathname);
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30 * 1000,
            retry: 1,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      <HistoryNavigationGuard />
      <AssistantContextProvider>
        {children}
        {workspace && <AiOperator hideCompactLauncher />}
      </AssistantContextProvider>
    </QueryClientProvider>
  );
}
