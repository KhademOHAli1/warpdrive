import type { Locale } from "@/features/i18n/registry";
import type { OperationsSearchResult } from "../operationsContracts";

export type OperationSearchGroups = Record<
  OperationsSearchResult["kind"],
  readonly OperationsSearchResult[]
>;

export const operationSearchKinds = ["location", "booking"] as const;

export const operationSearchHeadings: Record<
  Locale,
  Record<OperationsSearchResult["kind"], string>
> = {
  en: { location: "Locations", booking: "Bookings" },
  de: { location: "Standorte", booking: "Buchungen" },
  fa: { location: "مکان‌ها", booking: "رزروها" },
};

export const operationSearchPlaceholder: Record<Locale, string> = {
  en: "Search CRM, equipment, locations and bookings…",
  de: "CRM, Betriebsmittel, Standorte und Buchungen suchen…",
  fa: "جست‌وجوی CRM، تجهیزات، مکان‌ها و رزروها…",
};
