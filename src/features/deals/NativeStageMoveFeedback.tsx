"use client";
import { Button } from "@/components/ui/Button";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import type { useDealMove } from "./useDealMove";

export function NativeStageMoveFeedback({ move }: { move: ReturnType<typeof useDealMove> }) {
  const t = useAppTranslations("sales");
  const phase = move.state?.phase;
  const key = move.notice ?? phase;
  if (key === undefined) return null;
  return (
    <div
      role={
        phase !== undefined && phase !== "pending" && phase !== "confirmed" ? "alert" : "status"
      }
      aria-atomic="true"
      className="mx-4 mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-3 text-sm"
    >
      <p>{t(`nativeMove.${key}`)}</p>
      {phase !== "pending" &&
        (move.state !== null || move.notice === "invalid" || move.notice === "readFailed") && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={move.busy}
            onClick={() => {
              void move.loadCurrentState();
            }}
          >
            {t(move.busy ? "nativeMove.loading" : "nativeMove.load")}
          </Button>
        )}
    </div>
  );
}
