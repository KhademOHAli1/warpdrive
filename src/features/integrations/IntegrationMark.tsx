import { Plug } from "lucide-react";
import Image from "next/image";
import { cn } from "@/lib/utils";
import type { Integration } from "./catalog";

export function IntegrationMark({
  integration,
  compact = false,
}: {
  integration: Integration;
  compact?: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center ring-1",
        integration.id === "other-mcp" ? "bg-muted ring-border" : "bg-white ring-black/8",
        compact ? "size-7 rounded-md" : "size-11 rounded-xl shadow-xs",
      )}
    >
      {integration.id !== "other-mcp" ? (
        <Image
          src={`/integrations/${integration.id}.svg`}
          width={compact ? 16 : 24}
          height={compact ? 16 : 24}
          alt=""
          className={cn("object-contain", compact ? "size-4" : "size-6")}
        />
      ) : (
        <Plug className="size-6 text-muted-foreground" />
      )}
    </span>
  );
}
