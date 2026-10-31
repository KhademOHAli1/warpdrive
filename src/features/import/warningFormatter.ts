import { createAppTranslator } from "@/features/i18n/catalog";
import { type ImportDiagnosticOptions, importDiagnosticField } from "./diagnosticFormatter";

export function formatImportWarning(
  warning: { field: string; message: string },
  options: ImportDiagnosticOptions,
): string {
  if (options.locale === "en") return `${warning.field}: ${warning.message}`;
  const t = createAppTranslator(
    options.locale,
    "settings._extra.importWarnings",
    options.numberingSystem,
  );
  const owner =
    /^(?:owner|assignee) "(.+)" not assigned: (no matching user|several users match|not permitted)$/s.exec(
      warning.message,
    );
  let message = t("generic");
  if (owner) {
    const reason =
      owner[2] === "no matching user"
        ? "noMatchingUser"
        : owner[2] === "several users match"
          ? "multipleUsers"
          : "notPermitted";
    message = t("unassigned", { value: owner[1] ?? "", reason: t(reason) });
  } else if (/^(?:wonTime|lostTime) missing, used (?:createdAt|now)$/.test(warning.message)) {
    message = t("historyFallback");
  }
  return `${importDiagnosticField(warning.field, options)}: ${message}`;
}
