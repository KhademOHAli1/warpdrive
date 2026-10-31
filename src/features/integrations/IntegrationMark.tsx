import { cn } from "@/lib/utils";
import type { Integration } from "./catalog";

export function IntegrationMark({ integration }: { integration: Integration }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-10 shrink-0 items-center justify-center rounded-lg text-base font-semibold",
        integration.color,
      )}
    >
      {integration.mark}
    </span>
  );
}
