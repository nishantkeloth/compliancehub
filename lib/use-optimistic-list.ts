"use client";

import { useEffect, useState } from "react";

// Shared helper for "instant feeling" list screens: the UI updates the
// moment the user hits Save/Delete, while the actual server round-trip
// (and error handling / rollback) happens in the background. Each panel
// keeps its own local copy of the list, seeded from the server-fetched
// props and re-synced whenever those props change (e.g. after a
// background router.refresh() completes with the real, server-confirmed
// data — including a real id in place of any temporary one).
export function useOptimisticList<T extends { id: string }>(serverItems: T[]) {
  const [items, setItems] = useState<T[]>(serverItems);

  useEffect(() => {
    setItems(serverItems);
  }, [serverItems]);

  const addOptimistic = (item: T) => setItems((prev) => [...prev, item]);

  const updateOptimistic = (id: string, patch: Partial<T>) =>
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));

  const removeOptimistic = (id: string) => setItems((prev) => prev.filter((it) => it.id !== id));

  const restoreOptimistic = (item: T, atIndex?: number) =>
    setItems((prev) => {
      if (atIndex == null || atIndex < 0 || atIndex > prev.length) return [...prev, item];
      const next = [...prev];
      next.splice(atIndex, 0, item);
      return next;
    });

  return { items, setItems, addOptimistic, updateOptimistic, removeOptimistic, restoreOptimistic };
}

// A temporary client-side id for a row that hasn't been confirmed by the
// server yet. Swapped out automatically once the background refresh
// brings back the real row (see the useEffect above).
export function tempId() {
  return `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function isTempId(id: string) {
  return id.startsWith("temp-");
}
