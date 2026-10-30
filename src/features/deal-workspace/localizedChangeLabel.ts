import { sourceChannelLabel } from "@/constants/sourceChannelLabels";
import { isSourceChannelKey } from "@/constants/sourceChannels";
import { createAppTranslator, messagesForLocale } from "@/features/i18n/catalog";
import type { Locale } from "@/features/i18n/registry";
import { formatNumber } from "@/lib/localeFormatting";
import type { NumberingSystem } from "@/lib/numberingSystem";
import {
  contactPointAuditValue,
  isContactPointField,
  isolateAuditValue,
} from "./contactPointAuditValue";
import { asLostStatusValue } from "./lostStatusValue";

export interface ChangeDisplayEntry {
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

type SalesTranslator = ReturnType<typeof createAppTranslator<"sales">>;
type LinkKind = "person" | "org" | "participant" | "follower";
const linkedFields = new Map<string, LinkKind>([
  ["person_id", "person"],
  ["personId", "person"],
  ["org_id", "org"],
  ["orgId", "org"],
  ["participant", "participant"],
  ["follower", "follower"],
]);
const numericFields = new Set(["value", "org_annualRevenue", "org_employeeCount"]);

function value(
  v: unknown,
  locale: Locale,
  t: SalesTranslator,
  numberingSystem?: NumberingSystem,
): string {
  if (v === null || v === undefined || v === "") return t("changeLog.none");
  if (typeof v === "boolean") return t(v ? "changeLog.trueValue" : "changeLog.falseValue");
  if (typeof v === "number") return formatNumber(v, { locale, numberingSystem });
  return typeof v === "string" ? v : JSON.stringify(v);
}

function linkedChangeLabel(entry: ChangeDisplayEntry, t: SalesTranslator): string | null {
  const link = linkedFields.get(entry.field);
  if (link === undefined) return null;
  const had = entry.oldValue !== null && entry.oldValue !== undefined;
  const has = entry.newValue !== null && entry.newValue !== undefined;
  const dir = !had ? "Add" : !has ? "Remove" : "Change";
  const linkDir = (link === "participant" || link === "follower") && dir === "Change" ? "Add" : dir;
  return t(`changeLog.${link}${linkDir}` as "changeLog.personAdd");
}

function status(
  v: unknown,
  locale: Locale,
  t: SalesTranslator,
  numberingSystem?: NumberingSystem,
): string {
  if (v === "open") return t("computed.statusOpen");
  if (v === "won") return t("computed.statusWon");
  if (v === "lost") return t("computed.statusLost");
  return value(v, locale, t, numberingSystem);
}

function displayAuditValue(
  field: string,
  v: unknown,
  locale: Locale,
  t: SalesTranslator,
  numberingSystem?: NumberingSystem,
): string {
  if (isContactPointField(field))
    return contactPointAuditValue(v, locale) ?? value(v, locale, t, numberingSystem);
  if (field === "status") return status(v, locale, t, numberingSystem);
  if (
    (field === "source_channel" || field === "sourceChannel") &&
    typeof v === "string" &&
    isSourceChannelKey(v)
  )
    return sourceChannelLabel(v, locale);
  // Only known numeric columns carry canonical decimals. A title, custom value or legacy
  // diagnostic may look numeric but remains authored text. Intl receives the original string.
  if (
    numericFields.has(field.replaceAll(".", "_")) &&
    ((typeof v === "string" && /^[+-]?\d+(?:\.\d+)?$/.test(v)) ||
      (typeof v === "number" && Number.isFinite(v)))
  ) {
    const formatted = formatNumber(v, { locale, numberingSystem }, { maximumFractionDigits: 20 });
    if (formatted !== "") return formatted;
  }
  return Array.isArray(v)
    ? v.map((item) => value(item, locale, t, numberingSystem)).join(locale === "fa" ? "، " : ", ")
    : value(v, locale, t, numberingSystem);
}

function enrichedValue(raw: unknown): { value: unknown; providers: string[] } | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (!("value" in record) || !Array.isArray(record.providers)) return null;
  return {
    value: record.value,
    providers: record.providers.filter((v): v is string => typeof v === "string"),
  };
}

// Audit rows keep their raw values. Localized prose is generated when the viewer reads them.
export function localizedChangeLabel(
  entry: ChangeDisplayEntry,
  locale: Locale,
  numberingSystem?: NumberingSystem,
): string {
  const t = createAppTranslator(locale, "sales", numberingSystem);
  const linked = linkedChangeLabel(entry, t);
  if (linked !== null) return linked;
  const fields = new Map(Object.entries(messagesForLocale(locale).sales.changeLog.fields));
  const field = entry.field.startsWith("custom_field:")
    ? t("changeLog.customField")
    : (fields.get(entry.field.replaceAll(".", "_")) ?? t("changeLog.unknownField"));
  const lost = entry.field === "status" ? asLostStatusValue(entry.newValue) : null;
  const enriched = enrichedValue(entry.newValue);
  const newValue = lost !== null ? lost.value : enriched !== null ? enriched.value : entry.newValue;
  const diff = t("changeLog.change", {
    field,
    oldValue: isolateAuditValue(
      displayAuditValue(entry.field, entry.oldValue, locale, t, numberingSystem),
    ),
    newValue: isolateAuditValue(
      displayAuditValue(entry.field, newValue, locale, t, numberingSystem),
    ),
  });
  if (lost !== null) {
    const suffix = [lost.reason, lost.comment]
      .filter((v) => v !== null)
      .map((v) => isolateAuditValue(v))
      .join(" · ");
    return suffix === "" ? diff : `${diff} · ${suffix}`;
  }
  if (enriched !== null) {
    const providers = enriched.providers
      .map((v) => isolateAuditValue(v))
      .join(locale === "fa" ? "، " : ", ");
    return providers === "" ? diff : diff + t("changeLog.fromProviders", { providers });
  }
  return diff;
}
