"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function BlockCard({
  label,
  title,
  summary,
  icon,
  selected = false,
  invalid = false,
  result,
  children,
}: {
  label: string;
  title: string;
  summary?: string;
  icon: ReactNode;
  selected?: boolean;
  invalid?: boolean;
  result?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "relative w-[228px] rounded-md border bg-card px-3 py-3 text-start shadow-[0_1px_2px_rgb(0_0_0/0.04)]",
        selected ? "border-link ring-2 ring-link/15" : "border-border",
        invalid && "border-destructive/60",
      )}
    >
      {children}
      <div className="flex items-center gap-2.5">
        <span className="flex size-7 shrink-0 items-center justify-center rounded border bg-muted/30 text-muted-foreground">
          {icon}
        </span>
        <div className="min-w-0">
          <p className="text-[10px] leading-4 text-muted-foreground">{label}</p>
          <p className="truncate text-xs font-medium leading-5" dir="auto">
            {title}
          </p>
        </div>
      </div>
      {summary !== undefined && (
        <p className="mt-2 truncate text-[10px] leading-4 text-muted-foreground" dir="auto">
          {summary}
        </p>
      )}
      {result !== undefined && (
        <div className="mt-2 border-t pt-1.5 text-[11px] tabular-nums text-muted-foreground">
          {result}
        </div>
      )}
    </div>
  );
}
