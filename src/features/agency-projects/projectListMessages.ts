import { createTranslator } from "next-intl";
import type { MessageCatalog } from "@/features/i18n/messageTypes";
import type { Locale } from "@/features/i18n/registry";
import { localeWithNumberingSystem, type NumberingSystem } from "@/lib/numberingSystem";

const english = {
  heading: "Projects",
  states: "Project state",
  stateHint: "Choose at least one state.",
  loading: "Loading projects…",
  empty: "No projects match these filters.",
  error: "Projects could not be loaded. Try again.",
  retry: "Try again",
  next: "Next page",
  unavailable: "The project list is unavailable.",
  planned: "Planned",
  active: "Active",
  "on-hold": "On hold",
  completed: "Completed",
  canceled: "Canceled",
  archived: "Archived",
} as const;

const messages = {
  en: english,
  de: {
    heading: "Projekte",
    states: "Projektstatus",
    stateHint: "Wählen Sie mindestens einen Status aus.",
    loading: "Projekte werden geladen…",
    empty: "Keine Projekte entsprechen diesen Filtern.",
    error: "Die Projekte konnten nicht geladen werden. Versuchen Sie es erneut.",
    retry: "Erneut versuchen",
    next: "Nächste Seite",
    unavailable: "Die Projektliste ist nicht verfügbar.",
    planned: "Geplant",
    active: "Aktiv",
    "on-hold": "Pausiert",
    completed: "Abgeschlossen",
    canceled: "Abgebrochen",
    archived: "Archiviert",
  },
  fa: {
    heading: "پروژه‌ها",
    states: "وضعیت پروژه",
    stateHint: "دست‌کم یک وضعیت را انتخاب کنید.",
    loading: "در حال بارگذاری پروژه‌ها…",
    empty: "پروژه‌ای با این فیلترها پیدا نشد.",
    error: "بارگذاری پروژه‌ها ممکن نشد. دوباره تلاش کنید.",
    retry: "تلاش دوباره",
    next: "صفحهٔ بعد",
    unavailable: "فهرست پروژه‌ها در دسترس نیست.",
    planned: "برنامه‌ریزی‌شده",
    active: "فعال",
    "on-hold": "در حالت توقف",
    completed: "تکمیل‌شده",
    canceled: "لغوشده",
    archived: "بایگانی‌شده",
  },
} satisfies Record<Locale, MessageCatalog<typeof english>>;

export function projectListTranslator(locale: Locale, numberingSystem?: NumberingSystem) {
  return createTranslator({
    locale: localeWithNumberingSystem(locale, numberingSystem),
    messages: messages[locale],
  });
}
