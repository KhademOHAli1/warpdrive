import { sourceChannelLabel } from "@/constants/sourceChannelLabels";
import { isSourceChannelKey } from "@/constants/sourceChannels";
import { createAppTranslator, messagesForLocale } from "@/features/i18n/catalog";
import type { Locale } from "@/features/i18n/registry";
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

// Audit rows keep their raw values. Localized prose is generated when the viewer reads them.
export function localizedChangeLabel(entry: ChangeDisplayEntry, locale: Locale): string {
  const t = createAppTranslator(locale, "sales");
  const copy = messagesForLocale(locale).sales.changeLog;
  function value(v: unknown): string {
    if (v === null || v === undefined || v === "") return t("changeLog.none");
    if (typeof v === "boolean") return t(v ? "changeLog.trueValue" : "changeLog.falseValue");
    if (typeof v === "number") return new Intl.NumberFormat(locale).format(v);
    return typeof v === "string" ? v : JSON.stringify(v);
  }
  const had = entry.oldValue !== null && entry.oldValue !== undefined;
  const has = entry.newValue !== null && entry.newValue !== undefined;
  const dir = !had ? "Add" : !has ? "Remove" : "Change";
  const linked: Record<string, "person" | "org" | "participant" | "follower"> = {
    person_id: "person",
    personId: "person",
    org_id: "org",
    orgId: "org",
    participant: "participant",
    follower: "follower",
  };
  const link = linked[entry.field];
  if (link !== undefined) {
    const linkDir =
      (link === "participant" || link === "follower") && dir === "Change" ? "Add" : dir;
    return t(`changeLog.${link}${linkDir}` as "changeLog.personAdd");
  }
  const field = entry.field.startsWith("custom_field:")
    ? t("changeLog.customField")
    : (copy.fields[entry.field.replaceAll(".", "_") as keyof typeof copy.fields] ??
      t("changeLog.unknownField"));
  const status = (v: unknown): string =>
    v === "open"
      ? t("computed.statusOpen")
      : v === "won"
        ? t("computed.statusWon")
        : v === "lost"
          ? t("computed.statusLost")
          : value(v);
  const lost = entry.field === "status" ? asLostStatusValue(entry.newValue) : null;
  const record =
    typeof entry.newValue === "object" && entry.newValue !== null && !Array.isArray(entry.newValue)
      ? (entry.newValue as Record<string, unknown>)
      : null;
  const enriched =
    record !== null && "value" in record && Array.isArray(record.providers) ? record : null;
  const newValue = lost !== null ? lost.value : enriched !== null ? enriched.value : entry.newValue;
  const display = (v: unknown): string =>
    isContactPointField(entry.field)
      ? (contactPointAuditValue(v, locale) ?? value(v))
      : entry.field === "status"
        ? status(v)
        : (entry.field === "source_channel" || entry.field === "sourceChannel") &&
            typeof v === "string" &&
            isSourceChannelKey(v)
          ? sourceChannelLabel(v, locale)
          : Array.isArray(v)
            ? v.map(value).join("، ")
            : value(v);
  const diff = t("changeLog.change", {
    field,
    oldValue: isolateAuditValue(display(entry.oldValue)),
    newValue: isolateAuditValue(display(newValue)),
  });
  if (lost !== null) {
    const suffix = [lost.reason, lost.comment]
      .filter((v) => v !== null)
      .map((v) => isolateAuditValue(v))
      .join(" · ");
    return suffix === "" ? diff : `${diff} · ${suffix}`;
  }
  if (enriched !== null) {
    const providers = (enriched.providers as unknown[])
      .filter((v): v is string => typeof v === "string")
      .map((v) => isolateAuditValue(v))
      .join(locale === "fa" ? "، " : ", ");
    return providers === "" ? diff : diff + t("changeLog.fromProviders", { providers });
  }
  return diff;
}
