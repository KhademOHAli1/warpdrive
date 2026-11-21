import { useLocale } from "@/features/i18n/LocaleProvider";
import { useFormatters } from "@/lib/useFormatters";
import { useHydrated } from "@/lib/useHydrated";
import type { CatalogUnit } from "../../catalog/contracts";
import { unitLabel } from "../../catalog/ui/catalogDisplay";
import { catalogMessages } from "../../catalog/ui/catalogMessages";
import type { BomPart, BomPlanningQuery, BomRelease } from "../contracts";
import type { BomWords } from "./messages";

export type BomChoice = NonNullable<BomPlanningQuery["choices"]>[number];

export function releaseLabel({ part, revision }: BomRelease, t: BomWords) {
  return `${part.code} · ${part.revision} · ${t.release} ${revision} — ${part.name}`;
}

export function partLabel({ code, revision, name }: BomPart) {
  return `${code} · ${revision} — ${name}`;
}

export function useBomQuantity() {
  const t = catalogMessages[useLocale()];
  const { number: formatNumber } = useFormatters();
  const hydrated = useHydrated();
  const number = (value: number | string) =>
    hydrated ? formatNumber(value, { maximumFractionDigits: 10 }) : String(value);
  return {
    number,
    quantity: (value: number | string, unit: CatalogUnit) =>
      `${number(value)} ${unitLabel(unit, t)}`,
  };
}
