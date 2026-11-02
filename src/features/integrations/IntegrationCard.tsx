import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { ConnectionBadge } from "./ConnectionBadge";
import type { Integration } from "./catalog";
import { type ConnectionContext, connectionState } from "./connectionState";
import { IntegrationMark } from "./IntegrationMark";

export function IntegrationCard({
  integration,
  context,
  onSelect,
  onManage,
}: {
  integration: Integration;
  context: ConnectionContext;
  onSelect: (integration: Integration) => void;
  onManage: () => void;
}) {
  const t = useAppTranslations("integrations");
  const state = connectionState(integration, context);
  return (
    <article className="group flex min-w-0 flex-col rounded-xl border border-border/70 bg-card p-5 transition-colors hover:border-primary/35">
      <div className="flex items-center gap-3">
        <IntegrationMark integration={integration} />
        <div className="min-w-0">
          <h3 className="break-words text-sm font-semibold">
            <bdi>{integration.name}</bdi>
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t(integration.category === "ai" ? "aiCategory" : integration.category)}
          </p>
        </div>
      </div>
      <p className="mb-5 mt-4 flex-1 text-sm leading-relaxed text-muted-foreground">
        {t(integration.descriptionKey)}
      </p>
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 border-t border-border/50 pt-3">
        <ConnectionBadge status={state.status} />
        <Button
          type="button"
          variant="ghost"
          className="-me-2 min-h-9 max-w-full gap-2 px-2 text-xs text-primary"
          aria-label={`${t(state.action)}: ${integration.name}`}
          onClick={() => {
            if (state.action === "manage" || state.action === "finishSetup") onManage();
            else onSelect(integration);
          }}
        >
          <span className="whitespace-normal text-start">{t(state.action)}</span>
          <ArrowRight aria-hidden="true" className="size-3.5 shrink-0 rtl:rotate-180" />
        </Button>
      </div>
    </article>
  );
}
