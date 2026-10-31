import { ChevronDown, Search } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/Collapsible";
import { Input } from "@/components/ui/Input";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { cn } from "@/lib/utils";
import {
  filterIntegrations,
  INTEGRATION_CATEGORIES,
  INTEGRATIONS,
  type Integration,
  type IntegrationCategory,
  type IntegrationId,
} from "./catalog";
import type { ConnectionContext } from "./connectionState";
import { IntegrationCard } from "./IntegrationCard";

export function IntegrationDirectory({
  context,
  onSelect,
  onManage,
}: {
  context: ConnectionContext;
  onSelect: (integration: Integration) => void;
  onManage: () => void;
}) {
  const t = useAppTranslations("integrations");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<IntegrationCategory>("all");
  const [showPlanned, setShowPlanned] = useState(false);
  const searchText = Object.fromEntries(
    INTEGRATIONS.map((item) => [item.id, t(`providers.${item.id}.description`)]),
  ) as Record<IntegrationId, string>;
  const visible = filterIntegrations(query, category, searchText);
  const available = visible.filter((item) => item.delivery !== "planned");
  const planned = visible.filter((item) => item.delivery === "planned");
  const revealPlanned = showPlanned || query.trim().length > 0;
  const cards = (items: Integration[]) => (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((item) => (
        <IntegrationCard
          key={item.id}
          integration={item}
          context={context}
          onSelect={onSelect}
          onManage={onManage}
        />
      ))}
    </div>
  );

  return (
    <div className="space-y-7">
      <div className="space-y-4">
        <div className="relative max-w-md">
          <Search
            aria-hidden="true"
            className="absolute start-3 top-3 size-4 text-muted-foreground"
          />
          <label htmlFor="integration-search" className="sr-only">
            {t("search")}
          </label>
          <Input
            id="integration-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("search")}
            className="min-h-10 bg-card ps-9"
          />
        </div>
        <fieldset className="flex flex-wrap gap-1.5" aria-label={t("all")}>
          {INTEGRATION_CATEGORIES.map((item) => (
            <Button
              key={item}
              type="button"
              variant="ghost"
              aria-pressed={category === item}
              onClick={() => setCategory(item)}
              className={cn(
                "min-h-9 px-3 text-xs",
                category === item
                  ? "bg-accent font-medium text-foreground"
                  : "text-muted-foreground",
              )}
            >
              {t(item === "ai" ? "aiCategory" : item)}
            </Button>
          ))}
        </fieldset>
      </div>
      {available.length > 0 && (
        <section aria-labelledby="available-integrations-title" className="space-y-4">
          <div>
            <h2 id="available-integrations-title" className="text-sm font-semibold">
              {t("availableIntegrations")}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">{t("availableBody")}</p>
          </div>
          {cards(available)}
        </section>
      )}
      {planned.length > 0 && (
        <Collapsible open={revealPlanned} onOpenChange={setShowPlanned} className="border-t pt-5">
          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              className="h-auto w-full justify-between gap-3 px-0 py-2 text-start hover:bg-transparent"
            >
              <span>
                <span className="block text-sm font-medium">{t("exploreRoadmap")}</span>
                <span className="mt-1 block whitespace-normal text-xs font-normal leading-relaxed text-muted-foreground">
                  {t("roadmapBody", { count: planned.length })}
                </span>
              </span>
              <ChevronDown
                aria-hidden="true"
                className={cn(
                  "size-4 shrink-0 text-muted-foreground",
                  revealPlanned && "rotate-180",
                )}
              />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-4">{cards(planned)}</CollapsibleContent>
        </Collapsible>
      )}
      {visible.length === 0 && (
        <p
          role="status"
          className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground"
        >
          {t("emptySearch")}
        </p>
      )}
    </div>
  );
}
