import { createAppTranslator, messagesForLocale } from "@/features/i18n/catalog";
import type { Locale } from "@/features/i18n/registry";
import type { NumberingSystem } from "@/lib/numberingSystem";
import type { CustomFieldDef } from "@/types/customFields";
import { ENTITY_FIELDS, ENTITY_LABELS, type MappableEntity } from "./importFields";
import type { ImportTarget } from "./wizardState";

export interface ImportDiagnosticOptions {
  locale: Locale;
  numberingSystem?: NumberingSystem;
  target?: ImportTarget;
  defs?: readonly CustomFieldDef[];
}

type Diagnostic = { field: string; message: string };

// Stored prose predates localization. Recognize only the importer's known contracts;
// unknown historical diagnostics must never expose implementation details to viewers.
export function importDiagnosticMessage(
  diagnostic: string,
  options: ImportDiagnosticOptions,
): string {
  const t = createAppTranslator(
    options.locale,
    "settings._extra.importErrors",
    options.numberingSystem,
  );
  if (diagnostic === "ambiguous local time; include an explicit UTC offset")
    return createAppTranslator(options.locale, "dataConventions")("dates.ambiguous");
  if (diagnostic === "local time does not exist in the selected time zone")
    return createAppTranslator(options.locale, "dataConventions")("dates.nonexistent");
  switch (diagnostic) {
    case "not permitted to update":
      return t("permission");
    case "candidate vanished":
      return t("missing");
    case "no pipeline available to import into":
      return t("pipeline");
    case "pipeline has no stages":
      return t("stages");
    case "Required":
    case "required":
    case "required custom field is empty":
    case "organization name is required":
    case "person name is required":
      return t("required");
    case "must be a valid date":
      return t("date");
  }
  if (
    /^(?:String must contain at least 1 character\(s\)|Too small: expected string to have >=1 characters|(?:Invalid input: expected|Expected) string, received undefined)$/.test(
      diagnostic,
    )
  )
    return t("required");
  if (/^Invalid email(?: address)?$/.test(diagnostic)) return t("email");
  if (
    /^(?:(?:Invalid input: expected|Expected) number, received (?:nan|NaN|string|undefined)|must be a valid number)$/.test(
      diagnostic,
    )
  )
    return t("number");
  const unknown = /^unknown (pipeline|stage|activity type): (.+)$/s.exec(diagnostic);
  if (unknown) {
    const labels = messagesForLocale(options.locale).settings._labels.builtin;
    const kind =
      unknown[1] === "pipeline"
        ? labels.pipeline
        : unknown[1] === "stage"
          ? labels.stage
          : labels.type;
    return t("unknown", { kind, value: unknown[2] ?? "" });
  }
  const ambiguous =
    /^(?:ambiguous match: (\d+) existing contacts|ambiguous (?:organization|person) ".*": (\d+) matches)$/s.exec(
      diagnostic,
    );
  if (ambiguous) return t("ambiguous", { count: Number(ambiguous[1] ?? ambiguous[2]) });
  return t("invalid");
}

function isEntity(value: string): value is MappableEntity {
  return Object.hasOwn(ENTITY_FIELDS, value);
}

function builtinLabel(label: string, locale: Locale): string | undefined {
  const key = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  const labels = messagesForLocale(locale).settings._labels.builtin;
  return Object.hasOwn(labels, key) ? (labels as Record<string, string>)[key] : undefined;
}

function customFieldLabel(
  path: string,
  entity: MappableEntity,
  options: ImportDiagnosticOptions,
): string {
  const labels = messagesForLocale(options.locale).settings._extra.importDiagnostics;
  const [, key, endpoint] = path.split(".");
  const def = options.defs?.find(
    (candidate) => candidate.targetEntity === entity && candidate.key === key,
  );
  if (def === undefined) return labels.customField;
  if (endpoint === "start" || endpoint === "end") {
    const t = createAppTranslator(options.locale, "customFields", options.numberingSystem);
    return t(endpoint === "start" ? "rangeStart" : "rangeEnd", { name: def.name });
  }
  return def.name;
}

function standardFieldLabel(
  path: string,
  entity: MappableEntity,
  locale: Locale,
): string | undefined {
  const normalized =
    path === "email" || /^emails\.\d+(?:\.value)?$/.test(path)
      ? "emails"
      : /^phones\.\d+(?:\.value)?$/.test(path)
        ? "phones"
        : path;
  const metadata = ENTITY_FIELDS[entity].find((candidate) => candidate.field === normalized);
  if (metadata?.field === "currency")
    return messagesForLocale(locale).settings._extra.importDiagnostics.currency;
  return metadata === undefined ? undefined : builtinLabel(metadata.label, locale);
}

export function importDiagnosticField(field: string, options: ImportDiagnosticOptions): string {
  const labels = messagesForLocale(options.locale).settings._extra.importDiagnostics;
  if (field === "" || field === "_" || field === "_row") return labels.row;
  const firstDot = field.indexOf(".");
  const prefix = firstDot < 0 ? "" : field.slice(0, firstDot);
  const qualified = isEntity(prefix);
  const entity = qualified ? prefix : (options.target ?? "person");
  const path = qualified ? field.slice(firstDot + 1) : field;
  const label = path.startsWith("customFields.")
    ? customFieldLabel(path, entity, options)
    : standardFieldLabel(path, entity, options.locale);
  if (label === undefined || label === "") return labels.field;
  if (!qualified) return label;
  const entityLabel = builtinLabel(ENTITY_LABELS[entity], options.locale);
  return entityLabel !== undefined && entityLabel !== label ? `${entityLabel}[${label}]` : label;
}

export function formatImportDiagnostic(
  diagnostic: Diagnostic,
  options: ImportDiagnosticOptions,
): string {
  return `${importDiagnosticField(diagnostic.field, options)}: ${importDiagnosticMessage(diagnostic.message, options)}`;
}
