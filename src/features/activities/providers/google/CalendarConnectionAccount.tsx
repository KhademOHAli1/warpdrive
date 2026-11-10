"use client";
import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/Collapsible";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import type { CalendarAccountSummary } from "./accounts";
import { CalendarCatalogPanel } from "./CalendarCatalogPanel";
import type { useCalendarConnection } from "./useCalendarConnection";

export function CalendarConnectionAccount({
  account,
  configured,
  connection,
}: {
  account: CalendarAccountSummary;
  configured: boolean;
  connection: ReturnType<typeof useCalendarConnection>;
}): React.ReactNode {
  const t = useAppTranslations("calendar");
  const [open, setOpen] = useState(false);
  const disabled = connection.pending !== null;
  return (
    <li className="flex flex-wrap items-center gap-3 py-3 first:pt-0">
      <div className="min-w-0 flex-1 space-y-1">
        <p className="break-all text-sm font-medium" dir="auto">
          {account.emailAddress}
        </p>
        <Badge variant={account.status === "connected" ? "success" : "outline"}>
          {t(`googleConnection.status.${account.status}`)}
        </Badge>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={disabled || !configured}
          aria-label={t("googleConnection.reconnectAccount", { email: account.emailAddress })}
          onClick={() => {
            void connection.connect(account.id);
          }}
        >
          {t("googleConnection.reconnect")}
        </Button>
        {account.status !== "disconnected" && (
          <Button
            variant="ghost"
            size="sm"
            disabled={disabled}
            aria-label={t("googleConnection.disconnectAccount", { email: account.emailAddress })}
            onClick={() => connection.disconnect(account.id)}
          >
            {t("googleConnection.disconnect")}
          </Button>
        )}
      </div>
      {account.status === "connected" && (
        <Collapsible open={open} onOpenChange={setOpen} className="min-w-0 basis-full">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" disabled={disabled}>
              {t("googleConnection.catalog.title")}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-3">
            {open && (
              <CalendarCatalogPanel
                accountId={account.id}
                configured={configured}
                connection={connection}
              />
            )}
          </CollapsibleContent>
        </Collapsible>
      )}
    </li>
  );
}
