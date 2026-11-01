"use client";
import { Button } from "@/components/ui/Button";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";

export function SavedViewPending({
  error,
  onRetry,
}: {
  error: boolean;
  onRetry: () => void;
}): React.ReactNode {
  const t = useAppTranslations("viewCompatibility");
  return (
    <div
      role={error ? "alert" : "status"}
      aria-busy={!error}
      className="m-2 rounded-md border p-3 text-sm"
    >
      <p className="font-medium">{t(error ? "queryError" : "checkingTitle")}</p>
      {!error && <p className="mt-1 text-muted-foreground">{t("checkingBody")}</p>}
      {error && (
        <Button variant="outline" size="sm" className="mt-2" onClick={onRetry}>
          {t("retry")}
        </Button>
      )}
    </div>
  );
}
