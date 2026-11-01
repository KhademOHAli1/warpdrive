import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { cn } from "@/lib/utils";
import type { ConnectionStatus } from "./connectionState";

export function ConnectionBadge({ status }: { status: ConnectionStatus }) {
  const t = useAppTranslations("integrations");
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs leading-5",
        status === "connected"
          ? "text-emerald-700 dark:text-emerald-400"
          : status === "needsAttention" || status === "finishSetup"
            ? "text-amber-800 dark:text-amber-400"
            : "text-muted-foreground",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          status === "connected"
            ? "bg-emerald-500"
            : status === "needsAttention" || status === "finishSetup"
              ? "bg-amber-500"
              : "bg-muted-foreground/40",
        )}
      />
      {t(status)}
    </span>
  );
}
