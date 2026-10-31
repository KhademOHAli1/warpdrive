import { createTranslator } from "next-intl";
import type { EMAIL_SETTINGS_STRINGS } from "@/app/(app)/settings/email/strings";
import type { EMAIL_SYNC_STRINGS } from "@/app/(app)/settings/email-sync/strings";
import type { DATA_FIELDS_STRINGS } from "@/app/(app)/settings/fields/strings";
import type { ENRICHMENT_STRINGS } from "@/constants/enrichmentStrings";
import type {
  IDENTITY_ERROR_MESSAGES,
  IDENTITY_SETTINGS_STRINGS,
} from "@/constants/settingsIdentity";
import type { SETTINGS_STRINGS } from "@/constants/settingsStrings";
import type { MessageCatalog } from "@/features/i18n/messageTypes";
import type { Locale } from "@/features/i18n/registry";
import { localeWithNumberingSystem, type NumberingSystem } from "@/lib/numberingSystem";
import german from "./messages/settings.de.json";
import english from "./messages/settings.en.json";
import persian from "./messages/settings.fa.json";
import argumentNames from "./settingsMessageParams.json";

type Localized<Value> = Value extends (...args: infer Args) => unknown
  ? (...args: Args) => string
  : Value extends string
    ? string
    : Value extends readonly (infer Item)[]
      ? Localized<Item>[]
      : { [Key in keyof Value]: Localized<Value[Key]> };

type Source = typeof SETTINGS_STRINGS & {
  _identity: typeof IDENTITY_SETTINGS_STRINGS;
  _errors: typeof IDENTITY_ERROR_MESSAGES;
  _email: typeof EMAIL_SETTINGS_STRINGS;
  _emailSync: typeof EMAIL_SYNC_STRINGS;
  _fields: typeof DATA_FIELDS_STRINGS;
  _enrichment: Pick<typeof ENRICHMENT_STRINGS, "nav" | "settings" | "outcome">;
  _extra: typeof english._extra;
  _labels: typeof english._labels;
  _hierarchy: typeof english._hierarchy;
};
type ExtraFunctions = {
  stageCount: (count: number) => string;
  progressText: (processed: number, total: number, pct: number) => string;
  removeUser: (name: string) => string;
  noEmailNotice: (name: string, email: string) => string;
  nameSaveError: (id: string) => string;
  selectedCount: (count: number) => string;
  goalDisplayLabel: (noun: string, action: string, interval: string) => string;
  activityGoalDisplayLabel: (action: string, interval: string) => string;
  importErrors: Omit<typeof english._extra.importErrors, "unknown" | "ambiguous"> & {
    unknown: (kind: string, value: string) => string;
    ambiguous: (count: number) => string;
  };
  importWarnings: Omit<typeof english._extra.importWarnings, "unassigned"> & {
    unassigned: (value: string, reason: string) => string;
  };
};
export type SettingsMessages = Omit<Localized<Source>, "_extra"> & {
  _extra: Omit<Localized<Source["_extra"]>, keyof ExtraFunctions> & ExtraFunctions;
};
type Translate = (key: string, values?: Record<string, string | number>) => string;
const argumentsByPath: Record<string, string[]> = argumentNames;
const messagesByLocale: Record<Locale, MessageCatalog<typeof english>> = {
  en: english,
  fa: persian,
  de: german,
};

// Existing components retain typed field/function contracts while JSON is the only runtime copy.
export function settingsMessagesForLocale(
  locale: Locale,
  numberingSystem?: NumberingSystem,
): SettingsMessages {
  const translate = createTranslator({
    locale: localeWithNumberingSystem(locale, numberingSystem),
    messages: messagesByLocale[locale],
  }) as unknown as Translate;
  function localize(value: unknown, path: string): unknown {
    const parameters = argumentsByPath[path];
    if (parameters !== undefined) {
      return (...values: unknown[]) =>
        translate(
          path,
          Object.fromEntries(
            parameters.map((name, index) => {
              const argument = values[index];
              return [
                name,
                typeof argument === "number" || typeof argument === "string" ? argument : "",
              ];
            }),
          ),
        );
    }
    if (typeof value === "string") return value === "" ? value : translate(path);
    if (typeof value !== "object" || value === null) return value;
    const entries = Object.entries(value).map(([key, item]) => [
      key,
      localize(item, path === "" ? key : `${path}.${key}`),
    ]);
    return path === "mcpConnectSteps"
      ? entries.map(([, item]) => item)
      : Object.fromEntries(entries);
  }
  return localize(english, "") as SettingsMessages;
}

const ERROR_KEY: Record<string, keyof typeof IDENTITY_ERROR_MESSAGES> = {
  unauthorized: "permission",
  "permissions.manage required": "permission",
  "admin required to change admin role": "permission",
  "admin required to deactivate users": "permission",
  "admin required to assign an admin's permission set": "permission",
  "admin required to reactivate users": "reactivateAdmin",
  "missing csrf token": "session",
  "csrf token mismatch": "session",
  "origin mismatch": "session",
  "cross-site request rejected": "session",
  "cannot self-promote": "selfPromote",
  "cannot deactivate the last active admin": "lastAdmin",
  "cannot demote the last active admin": "lastAdmin",
  "cannot deactivate yourself": "selfDeactivate",
  "cannot edit your own permission set": "selfPermissionSet",
  "cannot reassign your own permission set": "selfPermissionSet",
  not_found: "notFound",
  "permission set not found": "notFound",
  "invalid input": "invalidInput",
};

export function settingsIdentityError(messages: SettingsMessages, error: string): string {
  return messages._errors[ERROR_KEY[error] ?? "generic"];
}

export function settingsBuiltinLabel(messages: SettingsMessages, label: string): string {
  const key = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  return (messages._labels.builtin as Record<string, string>)[key] ?? label;
}

export function settingsFieldType(messages: SettingsMessages, type: string): string {
  return (messages._labels.types as Record<string, string>)[type] ?? type.replaceAll("_", " ");
}

export function settingsPermissionLabel(messages: SettingsMessages, permission: string): string {
  return (
    (messages._labels.permissions as Record<string, string>)[permission.replaceAll(".", "_")] ??
    permission
  );
}

// Import workers persist diagnostic strings. Translate their known contracts at the UI boundary;
// file headers, submitted values, and stored diagnostics remain untouched.
export function settingsImportError(
  messages: SettingsMessages,
  diagnostic: string,
  locale: Locale,
): string {
  if (locale === "en") return diagnostic;
  const error = messages._extra.importErrors;
  if (diagnostic === "not permitted to update") return error.permission;
  if (diagnostic === "candidate vanished") return error.missing;
  if (diagnostic === "no pipeline available to import into") return error.pipeline;
  if (diagnostic === "pipeline has no stages") return error.stages;
  if (/required|expected string, received undefined|>=1|at least 1/i.test(diagnostic))
    return error.required;
  if (/email/i.test(diagnostic)) return error.email;
  if (/expected number|valid number/i.test(diagnostic)) return error.number;
  const unknown = /^unknown (pipeline|stage|activity type): (.+)$/.exec(diagnostic);
  if (unknown) {
    const kind =
      unknown[1] === "pipeline"
        ? messages._labels.builtin.pipeline
        : unknown[1] === "stage"
          ? messages._labels.builtin.stage
          : messages._labels.builtin.type;
    return error.unknown(kind, unknown[2] ?? "");
  }
  const count = /ambiguous.*?(\d+) (?:existing contacts|matches)/.exec(diagnostic);
  if (count) return error.ambiguous(Number(count[1]));
  return error.invalid;
}
