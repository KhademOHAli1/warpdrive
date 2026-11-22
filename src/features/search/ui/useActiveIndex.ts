"use client";
import { useMemo, useState } from "react";
import type { SearchResult, SearchResults } from "@/types/search";

export type ResultKind = "deal" | "person" | "organization" | "lead" | "equipment";

export interface FlatResult {
  kind: ResultKind;
  r: SearchResult;
}

// Flattens the CRM and equipment sections into a single ordered keyboard list
// and tracks a clamped active index
// across it, for arrow-key navigation in the command palette. The index
// resets to the first row whenever the result set's CONTENT changes (not
// just its length): two different queries can return the same number of
// rows with different ids, and keying the reset on length alone would leave
// a stale highlighted position pointing at the wrong row on Enter.
export function useActiveIndex(
  results: SearchResults,
  equipment: SearchResult[],
): {
  flat: FlatResult[];
  active: number;
  moveDown: () => void;
  moveUp: () => void;
} {
  const flat = useMemo<FlatResult[]>(
    () => [
      ...results.deals.map((r) => ({ kind: "deal" as const, r })),
      ...results.people.map((r) => ({ kind: "person" as const, r })),
      ...results.organizations.map((r) => ({ kind: "organization" as const, r })),
      ...results.leads.map((r) => ({ kind: "lead" as const, r })),
      ...equipment.map((r) => ({ kind: "equipment" as const, r })),
    ],
    [results, equipment],
  );
  const [active, setActive] = useState(0);

  // Stable content identity for the flat list: its ids, in order, joined
  // into one string. Plain strings compare by value, so the effect below
  // only re-runs when the actual ids change, not merely the array/object
  // reference.
  const flatIds = flat.map(({ kind, r }) => `${kind}:${r.id}`).join("|");

  // Reset the highlight whenever the result set changes. Adjusting during render (rather than in
  // an effect) means the stale index never reaches the DOM and no extra commit happens.
  const [seenIds, setSeenIds] = useState(flatIds);
  if (seenIds !== flatIds) {
    setSeenIds(flatIds);
    setActive(0);
  }

  function moveDown() {
    setActive((i) => Math.min(i + 1, flat.length - 1));
  }
  function moveUp() {
    setActive((i) => Math.max(i - 1, 0));
  }

  return { flat, active, moveDown, moveUp };
}
