"use client";

import { ArrowUpRight, Search } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useSharedBlocksMessages } from "../sharedBlocksMessages";

export interface BlockPaletteRow {
  id: string;
  label: string;
  category: string;
  icon?: ReactNode;
  description?: string;
  state: "ready" | "needs-setup" | "unavailable" | "denied";
  reason?: string;
  setupHref?: string;
}
function searchable(value: string) {
  return value.trim().toLocaleLowerCase().replaceAll("ي", "ی").replaceAll("ك", "ک");
}
export function BlockPalette({
  rows,
  categories,
  onChoose,
  disabled = false,
}: {
  rows: readonly BlockPaletteRow[];
  categories: Readonly<Record<string, string>>;
  onChoose: (id: string) => void;
  disabled?: boolean;
}) {
  const L = useSharedBlocksMessages();
  const [search, setSearch] = useState("");
  const matches = rows.filter((row) =>
    searchable(
      `${row.label} ${row.description ?? ""} ${categories[row.category] ?? row.category}`,
    ).includes(searchable(search)),
  );
  return (
    <div className="flex min-h-0 flex-col">
      <div className="relative shrink-0 border-b p-3">
        <Search
          aria-hidden
          className="pointer-events-none absolute start-5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          aria-label={L.searchBlocks}
          placeholder={L.searchBlocks}
          value={search}
          maxLength={200}
          onChange={(event) => setSearch(event.target.value)}
          className="h-8 ps-7 text-xs"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {[...new Set(matches.map((row) => row.category))].map((category) => (
          <section key={category} className="mb-3">
            <h3 className="px-2 py-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {categories[category] ?? category}
            </h3>
            {matches
              .filter((row) => row.category === category)
              .map((row) => (
                <div key={row.id}>
                  <Button
                    variant="ghost"
                    disabled={disabled || row.state === "unavailable" || row.state === "denied"}
                    className="h-auto min-h-9 w-full justify-start gap-2 rounded px-2 py-2 text-start text-xs font-normal"
                    onClick={() => onChoose(row.id)}
                  >
                    {row.icon}
                    <span className="min-w-0 flex-1">
                      <span className="block">{row.label}</span>
                      {row.state !== "ready" && (
                        <span className="mt-0.5 block text-[10px] text-muted-foreground">
                          {row.reason ??
                            L[
                              row.state === "needs-setup"
                                ? "needsSetup"
                                : row.state === "denied"
                                  ? "denied"
                                  : "unavailable"
                            ]}
                        </span>
                      )}
                    </span>
                  </Button>
                  {row.state === "needs-setup" && row.setupHref !== undefined && (
                    <a
                      href={row.setupHref}
                      className="mb-1 ms-8 inline-flex items-center gap-1 text-[10px] text-link"
                    >
                      {L.openSettings}
                      <ArrowUpRight className="size-3" aria-hidden />
                    </a>
                  )}
                </div>
              ))}
          </section>
        ))}
        {matches.length === 0 && (
          <p role="status" className="px-2 py-6 text-xs text-muted-foreground">
            {L.noMatches}
          </p>
        )}
      </div>
    </div>
  );
}
