"use client";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";

export function SavedViewSelectionStatus({ status }: { status: "idle" | "pending" | "failed" }) {
  const t = useAppTranslations("viewCompatibility");
  if (status === "idle") return null;
  return (
    <p
      role={status === "pending" ? "status" : "alert"}
      className="px-4 py-2 text-sm text-muted-foreground"
    >
      {t(status === "pending" ? "selectionSaving" : "selectionSaveFailed")}
    </p>
  );
}
