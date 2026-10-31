import { ArrowRight, CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { INTEGRATIONS } from "./catalog";
import { IntegrationMark } from "./IntegrationMark";
import type { ServiceConnectionView } from "./SlackConnection";

export function ConnectionOverview({
  services,
  mailbox,
  aiCount,
  onBrowse,
}: {
  services: ServiceConnectionView[];
  mailbox: { status: string } | null;
  aiCount: number;
  onBrowse: () => void;
}) {
  const t = useAppTranslations("integrations");
  const needsAttention = services.filter(
    (row) => row.status !== "connected" || !row.settings.channelId,
  );
  const mailAttention = mailbox !== null && mailbox.status !== "connected";
  const total =
    services.filter((row) => row.status === "connected").length +
    (mailbox?.status === "connected" ? 1 : 0) +
    aiCount;
  const slack = INTEGRATIONS.find((item) => item.id === "slack");
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">{t("workspaceTools")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("activeConnections", { count: total })}
          </p>
        </div>
        <Button type="button" variant="outline" onClick={onBrowse}>
          {t("addConnection")}
          <ArrowRight aria-hidden="true" className="size-4 rtl:rotate-180" />
        </Button>
      </div>
      {(needsAttention.length > 0 || mailAttention) && (
        <section
          aria-labelledby="attention-title"
          className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4"
        >
          <h3 id="attention-title" className="flex items-center gap-2 text-sm font-semibold">
            <CircleAlert className="size-4 text-amber-600" aria-hidden="true" />
            {t("needsAttention")}
          </h3>
          <ul className="mt-3 space-y-3">
            {needsAttention.map((row) => (
              <li key={row.id} className="flex items-center gap-3">
                {slack && <IntegrationMark integration={slack} />}
                <div className="min-w-0 flex-1">
                  <p className="break-words text-sm font-medium">
                    <bdi>{row.accountName}</bdi>
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                    {t(
                      row.status === "revocation-pending"
                        ? "revocationPending"
                        : row.status === "disconnected"
                          ? "connectionRemoved"
                          : "channelNeeded",
                    )}
                  </p>
                </div>
                <a
                  href={`#connection-${row.id}`}
                  className="shrink-0 text-sm font-medium text-primary underline-offset-4 hover:underline"
                >
                  {t("review")}
                </a>
              </li>
            ))}
            {mailAttention && (
              <li className="text-sm">
                <a href="#gmail-connection" className="font-medium text-primary">
                  {t("reviewGmail")}
                </a>
              </li>
            )}
          </ul>
        </section>
      )}
      {services.length === 0 && mailbox === null && aiCount === 0 && (
        <div className="rounded-xl border border-dashed p-8 text-center">
          <h3 className="text-sm font-semibold">{t("emptyConnections")}</h3>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
            {t("emptyConnectionsBody")}
          </p>
        </div>
      )}
    </div>
  );
}
