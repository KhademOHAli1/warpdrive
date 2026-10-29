import { createAppTranslator } from "@/features/i18n/catalog";
import type { Locale } from "@/features/i18n/registry";
// Mirrors the server size guard; MIME policy and object-storage keys remain independent of copy.
export const ATTACH_MAX_FILE_BYTES = 26_214_400;
export function fileAttachmentMessages(locale: Locale = "en") {
  const t = createAppTranslator(locale, "files");
  return {
    uploadLabel: t("upload"),
    emptyLabel: t("empty"),
    downloadLabel: (filename: string) => t("download", { name: filename }),
    tooLarge: (name: string, maxMb: number) => t("tooLarge", { name, maxMb }),
    unsupportedType: (name: string) => t("unsupportedType", { name }),
    uploadFailed: (name: string) => t("uploadFailed", { name }),
    downloadFailed: t("downloadFailed"),
  };
}
// Legacy pure callers keep the original English surface.
export const FILE_ATTACHMENTS_STRINGS = fileAttachmentMessages();
