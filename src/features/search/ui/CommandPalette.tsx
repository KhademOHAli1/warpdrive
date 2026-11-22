"use client";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { SearchResultsSkeleton } from "@/components/shell/skeletons";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useAppTranslations, useLocale } from "@/features/i18n/LocaleProvider";
import type { Locale } from "@/features/i18n/registry";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import { trpc } from "@/lib/trpc-client";
import type { SearchResult, SearchResults } from "@/types/search";
import type { OperationsSearchFixtureEntry } from "../operationsContracts";
import { searchOperationsFixture } from "../operationsFilter";
import {
  EMPTY_EQUIPMENT_RESULTS,
  type EquipmentSearchEntry,
  equipmentSearchPlaceholder,
  searchFixtureEquipment,
} from "./equipmentFixture";
import { OPEN_SEARCH_EVENT } from "./events";
import { type OperationSearchGroups, operationSearchPlaceholder } from "./operationsSearchMessages";
import { SearchResultsList } from "./SearchResultsList";
import { type ResultKind, resultKey, useActiveIndex } from "./useActiveIndex";
import { useSearchHotkey } from "./useSearchHotkey";

// Route map for each entity kind. Verified against real app routes (Task 15).
const ROUTES: Record<ResultKind, (id: string) => string> = {
  deal: (id) => `/deals/${id}`,
  person: (id) => `/contacts/people/${id}`,
  organization: (id) => `/contacts/orgs/${id}`,
  lead: (id) => `/leads/${id}`,
  asset: (id) => `/assets?assetId=${encodeURIComponent(id)}`,
  kit: (id) => `/assets?kitId=${encodeURIComponent(id)}`,
  location: (id) => `/locations?locationId=${encodeURIComponent(id)}`,
  booking: (id) => `/assets/bookings?bookingId=${encodeURIComponent(id)}`,
};

// Stable empty-results fallback, module-level so its reference never changes
// across renders (a fresh object each render would defeat the useActiveIndex
// memoization and reset logic even when there is genuinely no data yet).
const EMPTY_RESULTS: SearchResults = { deals: [], people: [], organizations: [], leads: [] };

function searchPlaceholder(
  locale: Locale,
  hasOperations: boolean,
  hasEquipment: boolean,
  fallback: string,
) {
  if (hasOperations) return operationSearchPlaceholder[locale];
  if (hasEquipment) return equipmentSearchPlaceholder[locale];
  return fallback;
}

// -- CommandPalette --
// Overlay that owns open/close state, the hotkey, and the window event listener.
// Mount once in the app layout so it is always available.
export function CommandPalette({
  fixtureEquipment,
  fixtureOperations,
  equipmentAvailable = false,
}: {
  fixtureEquipment?: readonly EquipmentSearchEntry[];
  fixtureOperations?: readonly OperationsSearchFixtureEntry[];
  equipmentAvailable?: boolean;
}) {
  const t = useAppTranslations("shell.search");
  const shell = useAppTranslations("shell");
  const locale = useLocale();
  const liveEquipment = fixtureEquipment === undefined && equipmentAvailable;
  const placeholder = searchPlaceholder(
    locale,
    (fixtureOperations?.length ?? 0) > 0,
    liveEquipment || fixtureEquipment !== undefined,
    shell("searchPlaceholder"),
  );
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // 150ms debounce on the query string.
  useEffect(() => {
    const id = setTimeout(() => setDebounced(q), 150);
    return () => clearTimeout(id);
  }, [q]);

  // Focus the input whenever the palette opens.
  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    }
  }, [open]);

  // Listen for the named custom event so the top-bar trigger can open us
  // without sharing state or context.
  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener(OPEN_SEARCH_EVENT, handler);
    return () => window.removeEventListener(OPEN_SEARCH_EVENT, handler);
  }, []);

  useSearchHotkey(() => setOpen(true));

  const typed = q.trim().length > 0;
  const searched = debounced.trim().length > 0;
  const { data, error } = trpc.search.query.useQuery({ q: debounced }, { enabled: searched });
  const equipmentRead = trpc.search.equipment.useQuery(
    { q: debounced },
    {
      enabled: open && searched && liveEquipment,
      staleTime: 0,
      gcTime: 0,
      refetchOnWindowFocus: true,
      retry: false,
    },
  );
  // A query in flight has not yet said the customer is absent, and "No organizations" read that way
  // is how a duplicate record gets created. Nothing zero-result renders until data arrives, and a
  // debounce still pending counts as in flight.
  const debouncing = q.trim() !== debounced.trim();
  const failed = !debouncing && error != null;
  const pending = typed && !failed && (data === undefined || debouncing);

  const results = data ?? EMPTY_RESULTS;
  const fixtureResults = useMemo(
    () => searchFixtureEquipment(fixtureEquipment, debounced),
    [fixtureEquipment, debounced],
  );
  // Withhold cached matches while the current site grants are being checked again.
  const equipment =
    liveEquipment && searched && !debouncing && !equipmentRead.isFetching && !equipmentRead.error
      ? (equipmentRead.data ?? EMPTY_EQUIPMENT_RESULTS)
      : fixtureResults;
  const operations = useMemo<OperationSearchGroups>(() => {
    const matches = searchOperationsFixture(fixtureOperations, debounced);
    return {
      location: matches.filter(({ kind }) => kind === "location"),
      booking: matches.filter(({ kind }) => kind === "booking"),
    };
  }, [fixtureOperations, debounced]);
  const { flat, active, moveDown, moveUp } = useActiveIndex(results, equipment, operations);
  const selection = flat[active];
  const activeKey = selection === undefined ? undefined : resultKey(selection.kind, selection.r.id);

  function close() {
    setOpen(false);
    setQ("");
    setDebounced("");
  }

  function handleSelect(kind: ResultKind, r: SearchResult) {
    close();
    router.push(ROUTES[kind](r.id));
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) close();
      }}
    >
      <DialogContent
        aria-describedby={undefined}
        className={`${BLOCK_CLASS} ph-no-capture top-[12%] max-w-lg translate-y-0 gap-0 overflow-hidden p-0 data-[state=open]:animate-none data-[state=closed]:animate-none`}
      >
        <DialogTitle className="sr-only">{placeholder}</DialogTitle>
        <div className="border-b px-3 py-2 pe-9">
          <input
            ref={inputRef}
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                close();
                return;
              }
              if (e.key === "ArrowDown") {
                e.preventDefault();
                moveDown();
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                moveUp();
              } else if (e.key === "Enter") {
                e.preventDefault();
                // `flat` still holds the last resolved query while a refinement is in flight, and
                // those rows are behind the skeleton. Acting on one navigates somewhere unseen.
                if (typed && !pending && !failed && selection !== undefined)
                  handleSelect(selection.kind, selection.r);
              }
            }}
            placeholder={placeholder}
            // Suppress the native type=search clear "x": the Dialog already renders a close X, so
            // the browser's clear button made two X's cluster at the top-right (keep one).
            className="w-full bg-transparent text-sm outline-none [&::-webkit-search-cancel-button]:appearance-none"
            aria-label={t("aria")}
          />
        </div>
        <div className="max-h-96 overflow-y-auto">
          {!typed ? (
            <p className="px-3 py-4 text-sm text-muted-foreground">{t("idle")}</p>
          ) : failed ? (
            <p role="alert" className="px-3 py-4 text-sm text-destructive">
              {t("error")}
            </p>
          ) : pending ? (
            <SearchResultsSkeleton />
          ) : (
            <SearchResultsList
              results={results}
              equipment={equipment}
              operations={operations}
              activeKey={activeKey}
              onSelect={handleSelect}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
