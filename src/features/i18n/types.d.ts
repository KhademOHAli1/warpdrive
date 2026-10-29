import type { NumberedLocale } from "@/lib/numberingSystem";
import type { AppMessages } from "./catalog";
import type { Locale as AppLocale } from "./registry";

declare module "next-intl" {
  interface AppConfig {
    Locale: NumberedLocale<AppLocale>;
    Messages: AppMessages;
  }
}
