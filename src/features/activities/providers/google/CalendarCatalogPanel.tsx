"use client";
import { Button } from "@/components/ui/Button";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { useFormatters } from "@/lib/useFormatters";
import { CalendarCatalogEntry } from "./CalendarCatalogEntry";
import { useCalendarCatalog } from "./useCalendarCatalog";
import type { useCalendarConnection } from "./useCalendarConnection";

function CatalogFeedback({
  catalog,
  pending,
}: {
  catalog: ReturnType<typeof useCalendarCatalog>;
  pending: boolean;
}): React.ReactNode {
  const t = useAppTranslations("calendar");
  const error = catalog.error ?? (catalog.data?.status === "error" ? "refreshFailed" : null);
  const review = error !== null && error !== "loadFailed" && catalog.blocked;
  return (
    <>
      {error !== null && (
        <p role="alert" className="text-sm text-destructive">
          {t(`googleConnection.catalog.${error}`)}
        </p>
      )}
      {error === "loadFailed" && (
        <Button variant="outline" size="sm" disabled={pending} onClick={catalog.retry}>
          {t("editor.retry")}
        </Button>
      )}
      {review && (
        <Button variant="outline" size="sm" disabled={pending} onClick={catalog.review}>
          {t("googleConnection.catalog.review")}
        </Button>
      )}
      {catalog.saved && (
        <p role="status" className="text-sm text-success">
          {t("googleConnection.catalog.saved")}
        </p>
      )}
    </>
  );
}
export function CalendarCatalogPanel({
  accountId,
  configured,
  connection,
}: {
  accountId: string;
  configured: boolean;
  connection: ReturnType<typeof useCalendarConnection>;
}): React.ReactNode {
  const t = useAppTranslations("calendar");
  const format = useFormatters();
  const catalog = useCalendarCatalog(accountId, connection);
  const pending = connection.pending !== null;
  const canAdd = configured && !catalog.blocked && catalog.data?.status === "ready";
  return (
    <div className="space-y-3 border-t pt-3">
      <Button
        variant="outline"
        size="sm"
        disabled={pending || !configured}
        onClick={catalog.discover}
      >
        {t("googleConnection.catalog.discover")}
      </Button>
      {catalog.data === undefined ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t("googleConnection.catalog.loading")}
        </p>
      ) : (
        <>
          {catalog.data.discoveredAt !== null && (
            <p className="text-xs text-muted-foreground">
              {t("googleConnection.catalog.lastChecked")}{" "}
              {format.dateTime(catalog.data.discoveredAt)}
            </p>
          )}
          {catalog.data.status === "refreshing" && (
            <p role="status" className="text-sm text-muted-foreground">
              {t("googleConnection.catalog.refreshing")}
            </p>
          )}
          {catalog.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("googleConnection.catalog.empty")}</p>
          ) : (
            <ul className="divide-y">
              {catalog.rows.map((row) => (
                <CalendarCatalogEntry
                  key={row.id}
                  row={row}
                  pending={pending}
                  canAdd={canAdd}
                  onSelect={catalog.select}
                />
              ))}
            </ul>
          )}
        </>
      )}
      <CatalogFeedback catalog={catalog} pending={pending} />
    </div>
  );
}
