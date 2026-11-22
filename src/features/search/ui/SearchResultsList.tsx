import { useAppTranslations, useLocale } from "@/features/i18n/LocaleProvider";
import type { SearchResult, SearchResults } from "@/types/search";
import type { EquipmentSearchResult } from "../equipmentContracts";
import { equipmentSearchHeading } from "./equipmentFixture";
import {
  type OperationSearchGroups,
  operationSearchHeadings,
  operationSearchKinds,
} from "./operationsSearchMessages";
import { type ResultKind, resultKey } from "./useActiveIndex";

// -- SearchResultsList --
// Presentational results: no tRPC; copy follows the viewer locale.
export function SearchResultsList({
  results,
  equipment,
  operations,
  activeKey,
  onSelect,
}: {
  results: SearchResults;
  equipment?: EquipmentSearchResult[];
  operations?: OperationSearchGroups;
  activeKey?: string;
  onSelect: (kind: ResultKind, result: SearchResult) => void;
}) {
  const t = useAppTranslations("shell.search");
  const locale = useLocale();
  return (
    <div role="listbox" aria-label={t("resultsLabel")}>
      <Section
        heading={t("headingDeals")}
        items={results.deals}
        empty={t("emptyDeals")}
        activeKey={activeKey}
        kind={() => "deal"}
        onSelect={onSelect}
      />
      <Section
        heading={t("headingPeople")}
        items={results.people}
        empty={t("emptyPeople")}
        activeKey={activeKey}
        kind={() => "person"}
        onSelect={onSelect}
      />
      <Section
        heading={t("headingOrganizations")}
        items={results.organizations}
        empty={t("emptyOrganizations")}
        activeKey={activeKey}
        kind={() => "organization"}
        onSelect={onSelect}
      />
      <Section
        heading={t("headingLeads")}
        items={results.leads}
        empty={t("emptyLeads")}
        activeKey={activeKey}
        kind={() => "lead"}
        onSelect={onSelect}
      />
      {equipment !== undefined && equipment.length > 0 && (
        <Section
          heading={equipmentSearchHeading[locale]}
          items={equipment}
          activeKey={activeKey}
          kind={(r) => r.kind}
          onSelect={onSelect}
        />
      )}
      {operations !== undefined &&
        operationSearchKinds.map((group) =>
          operations[group].length === 0 ? null : (
            <Section
              key={group}
              heading={operationSearchHeadings[locale][group]}
              items={operations[group]}
              activeKey={activeKey}
              kind={() => group}
              onSelect={onSelect}
            />
          ),
        )}
    </div>
  );
}

function Section<T extends SearchResult>({
  heading,
  items,
  empty,
  activeKey,
  kind,
  onSelect,
}: {
  heading: string;
  items: readonly T[];
  empty?: string;
  activeKey?: string;
  kind: (r: T) => ResultKind;
  onSelect: (kind: ResultKind, r: T) => void;
}) {
  return (
    <fieldset aria-label={heading} className="min-w-0">
      <p className="px-3 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {heading}
      </p>
      {items.length === 0 ? (
        <p className="px-3 py-1.5 text-sm text-muted-foreground">{empty}</p>
      ) : (
        items.map((r) => {
          const target = kind(r);
          const key = resultKey(target, r.id);
          const isActive = key === activeKey;
          return (
            <button
              key={key}
              type="button"
              role="option"
              aria-selected={isActive}
              ref={(el) => {
                if (isActive && el && typeof el.scrollIntoView === "function") {
                  el.scrollIntoView({ block: "nearest" });
                }
              }}
              className={`flex w-full items-center gap-2 px-3 py-2 text-start text-sm hover:bg-accent ${
                isActive ? "bg-accent" : ""
              }`}
              onClick={() => onSelect(target, r)}
            >
              <span className="flex-1 truncate">
                <bdi dir="auto">{r.primary}</bdi>
              </span>
              {r.secondary != null ? (
                <span className="max-w-[48%] truncate text-xs text-muted-foreground">
                  <bdi dir="auto">{r.secondary}</bdi>
                </span>
              ) : null}
            </button>
          );
        })
      )}
    </fieldset>
  );
}
