import { getLocalePreferences } from "@/features/i18n/server";
import { authScreensMessagesForLocale } from "../authScreensMessages";
import type { AuthFlowMessages } from "./authUiModel";

export async function authPageMetadata(key: keyof AuthFlowMessages) {
  return {
    title: authScreensMessagesForLocale((await getLocalePreferences()).locale).flow[key],
    referrer: "no-referrer" as const,
  };
}
