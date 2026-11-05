import type { WorkFieldDefinition } from "./contracts";
export type Locale = "en" | "de" | "fa";
type Local = [string, string, string];
export const localized = (v: Local, l: Locale) => v[l === "de" ? 1 : l === "fa" ? 2 : 0];
export const source = [
  {
    id: "vehicle_repair",
    name: ["Vehicle repair", "Kfz-Werkstatt", "تعمیر خودرو"],
    description: [
      "Estimates and authorization stay separate from repair and handover.",
      "Kostenvoranschlag und Freigabe bleiben von Reparatur und Übergabe getrennt.",
      "برآورد و تأیید از تعمیر و تحویل جدا می‌ماند.",
    ],
    sales: ["Repair inquiries", "Werkstattanfragen", "درخواست‌های تعمیر"],
    delivery: ["Repair jobs", "Reparaturaufträge", "سفارش‌های تعمیر"],
    salesStages: [
      ["Inquiry", "Anfrage", "درخواست"],
      ["Estimate preparation", "Kostenvoranschlag erstellen", "تهیه برآورد"],
      ["Estimate sent", "Kostenvoranschlag versandt", "ارسال برآورد"],
      ["Customer authorization", "Kundenfreigabe", "تأیید مشتری"],
    ],
    deliveryStages: [
      ["appointment", "Appointment", "Termin", "نوبت"],
      ["intake", "Vehicle intake", "Fahrzeugannahme", "پذیرش خودرو"],
      ["diagnosis", "Diagnosis", "Diagnose", "عیب‌یابی"],
      ["repair", "Repair", "Reparatur", "تعمیر"],
      ["quality_check", "Quality check", "Qualitätskontrolle", "کنترل کیفیت"],
      ["handover", "Handover", "Übergabe", "تحویل"],
    ],
    fields: [
      ["vehicle_registration", "Registration plate", "Kennzeichen", "پلاک", "text"],
      [
        "vin",
        "Vehicle identification number",
        "Fahrzeug-Identifizierungsnummer",
        "شماره شاسی",
        "text",
      ],
      ["mileage", "Mileage", "Kilometerstand", "کیلومتر", "number"],
      ["reported_fault", "Reported fault", "Beanstandung", "ایراد گزارش‌شده", "long_text"],
    ],
    dealField: [
      "estimate_reference",
      "Estimate reference",
      "Kostenvoranschlag-Referenz",
      "مرجع برآورد",
    ],
    activity: [
      "vehicle_inspection",
      "Vehicle inspection",
      "Fahrzeugprüfung",
      "بازرسی خودرو",
      "Wrench",
    ],
  },
  {
    id: "design",
    name: ["Design studio", "Designstudio", "استودیو طراحی"],
    description: [
      "Separate selling a project from briefs, reviews, approvals and delivery.",
      "Projektvertrieb von Briefing, Entwurf, Freigabe und Übergabe trennen.",
      "فروش پروژه از بریف، بازبینی، تأیید و تحویل جدا می‌شود.",
    ],
    sales: ["Design opportunities", "Design-Anfragen", "فرصت‌های طراحی"],
    delivery: ["Design projects", "Designprojekte", "پروژه‌های طراحی"],
    salesStages: [
      ["Inquiry", "Anfrage", "درخواست"],
      ["Discovery", "Erstgespräch", "شناخت نیاز"],
      ["Proposal", "Angebot", "پیشنهاد"],
      ["Negotiation", "Verhandlung", "مذاکره"],
    ],
    deliveryStages: [
      ["brief", "Brief", "Briefing", "بریف"],
      ["concept", "Research and concepts", "Recherche und Konzepte", "پژوهش و ایده"],
      ["review", "Client review", "Kundenfeedback", "بازبینی مشتری"],
      ["production", "Production", "Ausarbeitung", "تولید"],
      ["approval", "Final approval", "Endfreigabe", "تأیید نهایی"],
      ["handoff", "Handoff", "Übergabe", "تحویل"],
    ],
    fields: [
      ["deliverables", "Deliverables", "Lieferumfang", "اقلام تحویل", "long_text"],
      ["review_round", "Review round", "Korrekturrunde", "دور بازبینی", "number"],
      ["asset_location", "Asset location", "Ablageort", "محل فایل‌ها", "text"],
      ["usage_rights", "Usage rights notes", "Nutzungsrechte", "حقوق استفاده", "long_text"],
    ],
    dealField: ["project_scope", "Project scope", "Projektumfang", "دامنه پروژه"],
    activity: ["design_review", "Design review", "Design-Review", "بازبینی طراحی", "Palette"],
  },
  {
    id: "it_consulting",
    name: ["IT consulting", "IT-Beratung", "مشاوره فناوری اطلاعات"],
    description: [
      "Scope and procurement are sales; delivery, acceptance and handover are operational work.",
      "Scoping und Beschaffung gehören zum Vertrieb, Umsetzung und Abnahme zur Leistungserbringung.",
      "دامنه و خرید در فروش هستند؛ اجرا، پذیرش و تحویل کار عملیاتی هستند.",
    ],
    sales: ["Consulting opportunities", "Beratungsanfragen", "فرصت‌های مشاوره"],
    delivery: ["Consulting engagements", "Beratungsmandate", "پروژه‌های مشاوره"],
    salesStages: [
      ["Lead", "Anfrage", "سرنخ"],
      ["Discovery", "Bedarfsanalyse", "شناخت نیاز"],
      ["Scoping", "Leistungsumfang", "تعیین دامنه"],
      ["Proposal", "Angebot", "پیشنهاد"],
      ["Procurement and security", "Beschaffung und Sicherheit", "خرید و امنیت"],
    ],
    deliveryStages: [
      ["kickoff", "Kickoff", "Projektstart", "شروع"],
      ["delivery", "Delivery", "Umsetzung", "اجرا"],
      ["acceptance", "Acceptance", "Abnahme", "پذیرش"],
      ["handover", "Handover", "Übergabe", "تحویل"],
    ],
    fields: [
      ["scope", "Scope of work", "Leistungsumfang", "دامنه کار", "long_text"],
      [
        "acceptance_criteria",
        "Acceptance criteria",
        "Abnahmekriterien",
        "معیارهای پذیرش",
        "long_text",
      ],
      [
        "environment",
        "Environment reference (no credentials)",
        "Umgebungsreferenz (keine Zugangsdaten)",
        "مرجع محیط (بدون اطلاعات ورود)",
        "text",
      ],
      [
        "effort_days",
        "Estimated effort (days)",
        "Geschätzter Aufwand (Tage)",
        "تلاش تخمینی (روز)",
        "number",
      ],
    ],
    dealField: [
      "procurement_reference",
      "Procurement reference",
      "Beschaffungsreferenz",
      "مرجع خرید",
    ],
    activity: [
      "consulting_workshop",
      "Consulting workshop",
      "Beratungsworkshop",
      "کارگاه مشاوره",
      "Presentation",
    ],
  },
] as const;
export function field(
  key: string,
  label: string,
  type: WorkFieldDefinition["type"],
): WorkFieldDefinition {
  return { key, label, type, options: [], required: false };
}
