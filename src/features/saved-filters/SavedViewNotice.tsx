"use client";
import { Button } from "@/components/ui/Button";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";

type SavedViewNoticeProps =
  | { state: "checking" | "query-error"; onRetry: () => void }
  | { state: "unavailable"; name?: string; missing?: boolean; onClear: () => void };

export function SavedViewNotice(props: SavedViewNoticeProps): React.ReactNode {
  const t = useAppTranslations("viewCompatibility");
  const unavailable = props.state === "unavailable";
  const checking = props.state === "checking";
  const title = unavailable ? "title" : checking ? "checkingTitle" : "queryError";
  const body = unavailable ? (props.missing === true ? "missingBody" : "body") : "checkingBody";

  return (
    <div
      // Replace the region when its action changes from query recovery to clearing the selection.
      key={unavailable ? "unavailable" : "query"}
      role={checking ? "status" : "alert"}
      aria-busy={unavailable ? undefined : checking}
      className={
        unavailable
          ? "m-2 basis-full rounded-md border p-3 text-sm"
          : "m-2 rounded-md border p-3 text-sm"
      }
    >
      <p className="font-medium">{t(title)}</p>
      {unavailable && props.name !== undefined && props.name !== "" && (
        <p>
          <bdi dir="auto">{props.name}</bdi>
        </p>
      )}
      {(unavailable || checking) && <p className="mt-1 text-muted-foreground">{t(body)}</p>}
      {!checking && (
        <Button
          variant="outline"
          size="sm"
          className="mt-2"
          onClick={unavailable ? props.onClear : props.onRetry}
        >
          {t(unavailable ? "showAll" : "retry")}
        </Button>
      )}
    </div>
  );
}
