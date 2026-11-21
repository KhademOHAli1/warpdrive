import { createTranslator } from "next-intl";
import type { MessageCatalog } from "@/features/i18n/messageTypes";
import type { Locale } from "@/features/i18n/registry";
import { localeWithNumberingSystem, type NumberingSystem } from "@/lib/numberingSystem";

const en = {
  title: "Your work",
  navigation: "Your work views",
  summary: "Summary",
  assigned: "Assigned",
  created: "Created",
  subscribed: "Subscribed",
  activity: "Activity",
  activityCreated: "Created",
  activityUpdated: "Updated",
  overview: "Overview",
  byStatus: "Assigned work by status",
  byPriority: "Assigned work by priority",
  filterStatus: "Filter by status",
  filterPriority: "Filter by priority",
  allStatuses: "All statuses",
  allPriorities: "All priorities",
  emptyAssigned: "No assigned work items",
  emptyAssignedDescription: "Work assigned to you in your internal projects will appear here.",
  emptyCreated: "No created work items",
  emptyCreatedDescription: "Work you create in your internal projects will appear here.",
  emptySubscribed: "No subscribed work items",
  emptySubscribedDescription: "Open an internal project work item to subscribe to it.",
  emptyActivity: "No work item activity yet",
  emptyActivityDescription: "Work items you create or update will appear here.",
  emptyFiltered: "No work items match these filters.",
  clearFilters: "Clear filters",
  pagination: "Work item pages",
  firstPage: "First page",
  nextPage: "Next page",
  unavailable: "Your work could not be loaded.",
};

const de = {
  title: "Deine Aufgaben",
  navigation: "Ansichten deiner Aufgaben",
  summary: "Übersicht",
  assigned: "Zugewiesen",
  created: "Erstellt",
  subscribed: "Abonniert",
  activity: "Aktivität",
  activityCreated: "Erstellt",
  activityUpdated: "Aktualisiert",
  overview: "Auf einen Blick",
  byStatus: "Zugewiesene Aufgaben nach Status",
  byPriority: "Zugewiesene Aufgaben nach Priorität",
  filterStatus: "Nach Status filtern",
  filterPriority: "Nach Priorität filtern",
  allStatuses: "Alle Status",
  allPriorities: "Alle Prioritäten",
  emptyAssigned: "Keine zugewiesenen Aufgaben",
  emptyAssignedDescription:
    "Hier erscheinen Aufgaben, die dir in internen Projekten zugewiesen sind.",
  emptyCreated: "Keine erstellten Aufgaben",
  emptyCreatedDescription: "Hier erscheinen Aufgaben, die du in internen Projekten erstellst.",
  emptySubscribed: "Keine abonnierten Aufgaben",
  emptySubscribedDescription: "Öffne eine interne Projektaufgabe, um sie zu abonnieren.",
  emptyActivity: "Noch keine Aufgabenaktivität",
  emptyActivityDescription: "Hier erscheinen Aufgaben, die du erstellst oder aktualisierst.",
  emptyFiltered: "Keine Aufgaben entsprechen diesen Filtern.",
  clearFilters: "Filter zurücksetzen",
  pagination: "Aufgabenseiten",
  firstPage: "Erste Seite",
  nextPage: "Nächste Seite",
  unavailable: "Deine Aufgaben konnten nicht geladen werden.",
};

const fa = {
  title: "کارهای شما",
  navigation: "نماهای کارهای شما",
  summary: "خلاصه",
  assigned: "واگذارشده",
  created: "ایجادشده",
  subscribed: "دنبال‌شده",
  activity: "فعالیت",
  activityCreated: "ایجاد شد",
  activityUpdated: "به‌روزرسانی شد",
  overview: "نمای کلی",
  byStatus: "کارهای واگذارشده بر اساس وضعیت",
  byPriority: "کارهای واگذارشده بر اساس اولویت",
  filterStatus: "فیلتر بر اساس وضعیت",
  filterPriority: "فیلتر بر اساس اولویت",
  allStatuses: "همهٔ وضعیت‌ها",
  allPriorities: "همهٔ اولویت‌ها",
  emptyAssigned: "کاری به شما واگذار نشده است",
  emptyAssignedDescription:
    "کارهایی که در پروژه‌های داخلی به شما واگذار شده‌اند اینجا نمایش داده می‌شوند.",
  emptyCreated: "کاری ایجاد نکرده‌اید",
  emptyCreatedDescription: "کارهایی که در پروژه‌های داخلی ایجاد می‌کنید اینجا نمایش داده می‌شوند.",
  emptySubscribed: "کاری را دنبال نمی‌کنید",
  emptySubscribedDescription: "برای دنبال کردن یک کار، آن را در پروژهٔ داخلی باز کنید.",
  emptyActivity: "هنوز فعالیتی ثبت نشده است",
  emptyActivityDescription: "کارهایی که ایجاد یا به‌روزرسانی می‌کنید اینجا نمایش داده می‌شوند.",
  emptyFiltered: "کاری مطابق این فیلترها وجود ندارد.",
  clearFilters: "پاک کردن فیلترها",
  pagination: "صفحه‌های کارها",
  firstPage: "صفحهٔ اول",
  nextPage: "صفحهٔ بعد",
  unavailable: "بارگذاری کارهای شما ممکن نبود.",
};

const messages = { en, de, fa } satisfies Record<Locale, MessageCatalog<typeof en>>;

export function projectProfileTranslator(locale: Locale, numberingSystem?: NumberingSystem) {
  return createTranslator({
    locale: localeWithNumberingSystem(locale, numberingSystem),
    messages: messages[locale],
  });
}
