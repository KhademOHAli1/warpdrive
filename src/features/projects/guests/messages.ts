import type { Locale } from "@/features/i18n/registry";

const en = {
  access: "Access",
  guest: "Guest",
  memberRole: "Project role",
  discover: "Discover projects",
  join: "Join project",
  visibility: "Project visibility",
  private: "Private",
  workspace: "Open to workspace members",
  discoveryHelp:
    "Open projects appear in discovery for signed-in workspace members. They must join before they can open project work.",
  guestAll: "Let guests view all project work and features",
  guestHelp:
    "Guests can see work items they created. If Intake is enabled, they can submit and manage their own requests. Enable expanded guest access to show all project work and features.",
  save: "Save changes",
  saved: "Project access saved.",
  invite: "Invite project guest",
  inviteHelp: "Invite someone with access only to projects they are added to.",
  name: "Guest name",
  email: "Guest email",
  queued: "Guest invitation queued.",
  pending: "Invitation pending",
  emailUnavailable: "Use an email address that does not already have a Warpdrive account.",
};

const de: typeof en = {
  access: "Zugriff",
  guest: "Gast",
  memberRole: "Projektrolle",
  discover: "Projekte entdecken",
  join: "Projekt beitreten",
  visibility: "Projektsichtbarkeit",
  private: "Privat",
  workspace: "Offen für Arbeitsbereichsmitglieder",
  discoveryHelp:
    "Offene Projekte werden angemeldeten Arbeitsbereichsmitgliedern angezeigt. Mitglieder müssen beitreten, um Projektaufgaben zu öffnen.",
  guestAll: "Gästen alle Projektaufgaben und Funktionen anzeigen",
  guestHelp:
    "Gäste sehen ihre selbst erstellten Aufgaben. Bei aktivierter Annahme können sie eigene Anfragen einreichen und verwalten. Der erweiterte Gastzugriff zeigt alle Projektaufgaben und Funktionen.",
  save: "Änderungen speichern",
  saved: "Projektzugriff gespeichert.",
  invite: "Projektgast einladen",
  inviteHelp: "Lade jemanden ein, der nur auf die zugewiesenen Projekte zugreifen kann.",
  name: "Gastname",
  email: "Gast-E-Mail-Adresse",
  queued: "Gasteinladung wurde in die Warteschlange gestellt.",
  pending: "Einladung ausstehend",
  emailUnavailable: "Verwende eine E-Mail-Adresse, für die noch kein Warpdrive-Konto besteht.",
};

const fa: typeof en = {
  access: "دسترسی",
  guest: "مهمان",
  memberRole: "نقش پروژه",
  discover: "یافتن پروژه‌ها",
  join: "پیوستن به پروژه",
  visibility: "نمایانی پروژه",
  private: "خصوصی",
  workspace: "باز برای اعضای فضای کاری",
  discoveryHelp:
    "اعضایی که وارد فضای کاری شده‌اند می‌توانند پروژه‌های باز را پیدا کنند. برای دیدن کارهای پروژه باید به آن بپیوندند.",
  guestAll: "نمایش همهٔ کارها و قابلیت‌های پروژه به مهمانان",
  guestHelp:
    "مهمانان کارهایی را می‌بینند که خودشان ایجاد کرده‌اند. با فعال بودن پذیرش، می‌توانند درخواست‌های خود را ثبت و مدیریت کنند. دسترسی گسترده همهٔ کارها و قابلیت‌های پروژه را نمایش می‌دهد.",
  save: "ذخیرهٔ تغییرات",
  saved: "دسترسی پروژه ذخیره شد.",
  invite: "دعوت مهمان پروژه",
  inviteHelp: "فردی را دعوت کنید که تنها به پروژه‌های تعیین‌شده برای او دسترسی داشته باشد.",
  name: "نام مهمان",
  email: "ایمیل مهمان",
  queued: "دعوت مهمان در صف ارسال قرار گرفت.",
  pending: "در انتظار پذیرش دعوت",
  emailUnavailable: "از ایمیلی استفاده کنید که هنوز حساب Warpdrive ندارد.",
};

export const guestLabels: Record<Locale, typeof en> = { en, de, fa };
