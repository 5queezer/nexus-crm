"use client";

import { useSyncExternalStore } from "react";

const REFRESH_MS = 60_000;
const listeners = new Set<() => void>();
let snapshot: number | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (timer === null) {
    snapshot = Date.now();
    timer = setInterval(() => {
      snapshot = Date.now();
      emit();
    }, REFRESH_MS);
    // The first reading only exists once something subscribes, so publish it.
    queueMicrotask(emit);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

const getSnapshot = (): number | null => snapshot;
const getServerSnapshot = (): number | null => null;

/**
 * Wall-clock time in milliseconds, refreshed once a minute, or `null` before
 * the first client reading. Rendering `null` on the server and on the first
 * paint keeps time-dependent output out of hydration mismatches, and reading
 * the clock through a store keeps render functions pure.
 */
export function useNow(): number | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
