import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/Collapsible";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { useFormatters } from "@/lib/useFormatters";
import type { ServiceConnectionView } from "./SlackConnection";

export function ConnectionFacts({ connection }: { connection: ServiceConnectionView }) {
  const t = useAppTranslations("integrations");
  const format = useFormatters();
  return (
    <>
      <dl className="grid gap-x-5 gap-y-4 rounded-xl bg-muted/30 p-4 text-xs sm:grid-cols-3">
        <div>
          <dt className="text-muted-foreground">{t("connectedBy")}</dt>
          <dd className="mt-1.5 break-words font-medium">
            <bdi>{connection.ownerName ?? t("unknownAuthorizer")}</bdi>
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t("connectedSince")}</dt>
          <dd className="mt-1.5 font-medium">
            {connection.connectedAt !== undefined
              ? format.dateTime(connection.connectedAt)
              : t("unknownDate")}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t("lastChecked")}</dt>
          <dd className="mt-1.5 font-medium">
            {connection.lastCheckedAt !== null
              ? format.dateTime(connection.lastCheckedAt)
              : t("neverChecked")}
          </dd>
        </div>
      </dl>
      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            className="h-auto gap-2 px-0 py-1.5 text-xs text-muted-foreground"
          >
            {t("grantedAccess")}
            <ChevronDown className="size-3" aria-hidden="true" />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-3 pb-2 pt-2">
          <p className="text-xs leading-relaxed text-muted-foreground">{t("slackAccess")}</p>
          <ul className="flex flex-wrap gap-2">
            {connection.scopes?.map((scope) => (
              <li key={scope}>
                <code dir="ltr" className="rounded-md bg-muted px-2 py-1 text-[11px]">
                  {scope}
                </code>
              </li>
            ))}
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </>
  );
}
