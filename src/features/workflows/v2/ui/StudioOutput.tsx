"use client";
import type { BlockJson } from "@/features/blocks/contracts";
import { useSharedBlocksMessages } from "@/features/blocks/sharedBlocksMessages";
import { useFormatters } from "@/lib/useFormatters";
export function StudioOutput({ value, depth = 0 }: { value: unknown; depth?: number }) {
  const L = useSharedBlocksMessages();
  const format = useFormatters();
  if (typeof value === "boolean") return <span>{value ? L.true : L.false}</span>;
  if (typeof value === "number")
    return <span className="tabular-nums">{format.number(value)}</span>;
  if (typeof value === "string")
    return (
      <span className="break-words" dir="auto">
        {value}
      </span>
    );
  if (value === null || value === undefined) return <span>—</span>;
  if (depth > 5 || typeof value !== "object") return null;
  const entries = Object.entries(value as Record<string, BlockJson>);
  return (
    <dl className="space-y-2">
      {entries.slice(0, 50).map(([key, child]) => (
        <div key={key} className="border-s ps-2">
          <dt className="text-[10px] text-muted-foreground" dir="auto">
            {key}
          </dt>
          <dd className="mt-0.5 text-xs">
            <StudioOutput value={child} depth={depth + 1} />
          </dd>
        </div>
      ))}
    </dl>
  );
}
