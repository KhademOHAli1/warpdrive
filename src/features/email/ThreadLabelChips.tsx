"use client";
import type React from "react";
import { trpc } from "@/lib/trpc-client";
import { resolveMailLabelChips } from "./mailLabelResolve";

// Colored chips for a thread's applied mail labels (U6 catalog + U7 visual). Resolves each stored
// key against the user-managed mail-label catalog for its display name + color, so custom labels
// render (not just the three built-ins) and a legacy token still resolves via its seeded built-in.
// Keys with no catalog entry are skipped so a stray token never renders an unstyled chip. A15:
// chips render uppercase at 10px so they read as Pipedrive-style tags.
export function ThreadLabelChips({ labels }: { labels: string[] }): React.ReactNode {
  const catalog = trpc.mailLabels.list.useQuery().data ?? [];
  const chips = resolveMailLabelChips(catalog, labels);
  if (chips.length === 0) return null;
  return (
    <span className="flex shrink-0 items-center gap-1">
      {chips.map((chip) => (
        <span
          key={chip.key}
          className={`rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${chip.classes}`}
        >
          {chip.name}
        </span>
      ))}
    </span>
  );
}
