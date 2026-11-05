import type { RegionalNumberedLocale } from "@/lib/numberingSystem";
import type { AppMessages } from "./catalog";
import type { Locale as AppLocale } from "./registry";

declare module "next-intl" {
  interface AppConfig {
    Locale: RegionalNumberedLocale<AppLocale>;
    Messages: AppMessages;
  }
}
