"use client";

import { useLayoutEffect } from "react";

export const BEFORE_HISTORY_NAVIGATION = "nexus:before-history-navigation";

/** Register once, before the router's passive popstate listener. At the
 * window target, registration order matters even for capture listeners.
 * Page-local listeners can otherwise be unmounted by the router first. */
export function HistoryNavigationGuard() {
  useLayoutEffect(() => {
    function beforeHistoryNavigation(event: PopStateEvent) {
      const check = new Event(BEFORE_HISTORY_NAVIGATION, { cancelable: true });
      window.dispatchEvent(check);
      if (check.defaultPrevented) event.stopImmediatePropagation();
    }
    window.addEventListener("popstate", beforeHistoryNavigation, true);
    return () => window.removeEventListener("popstate", beforeHistoryNavigation, true);
  }, []);
  return null;
}
