import { createAppTranslator } from "@/features/i18n/catalog";
import type { Locale } from "@/features/i18n/registry";

// These controls are introduced only in display text, never written to an audit payload.
export function isolateAuditValue(value: string, direction: "auto" | "ltr" = "auto"): string {
  return `${direction === "ltr" ? "\u2066" : "\u2068"}${value}\u2069`;
}
export function isContactPointField(field: string): boolean {
  return field === "person.phones" || field === "person.emails";
}

export function contactPointAuditValue(value: unknown, locale: Locale): string | null {
  const t = createAppTranslator(locale, "sales");
  const labels = {
    work: "computed.work",
    home: "computed.home",
    mobile: "computed.mobile",
    other: "computed.other",
  } as const;
  function point(raw: unknown): string {
    if (typeof raw === "string") return isolateAuditValue(raw, "ltr");
    if (typeof raw !== "object" || raw === null || Array.isArray(raw))
      return JSON.stringify(raw) ?? "";
    const record = raw as Record<string, unknown>;
    const supported =
      typeof record.value === "string" &&
      (record.label === undefined || typeof record.label === "string") &&
      (record.primary === undefined || typeof record.primary === "boolean") &&
      Object.keys(record).every((key) => key === "value" || key === "label" || key === "primary");
    if (!supported) return JSON.stringify(raw);
    const metadata: string[] = [];
    if (typeof record.label === "string" && record.label !== "") {
      const key = record.label.trim().toLowerCase() as keyof typeof labels;
      metadata.push(isolateAuditValue(Object.hasOwn(labels, key) ? t(labels[key]) : record.label));
    }
    if (record.primary === true) metadata.push(t("changeLog.primary"));
    const display = isolateAuditValue(record.value as string, "ltr");
    return metadata.length === 0
      ? display
      : t("changeLog.contactPoint", {
          value: display,
          metadata: metadata.join(locale === "fa" ? "، " : ", "),
        });
  }
  if (Array.isArray(value))
    return value.length === 0
      ? t("changeLog.none")
      : value.map(point).join(locale === "fa" ? "؛ " : "; ");
  if (typeof value === "object" && value !== null) return point(value);
  return null;
}
