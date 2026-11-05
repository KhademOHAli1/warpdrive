import type { Locale } from "@/features/i18n/registry";
import type { KpiCondition, KpiDefinitionInput, KpiUnit } from "./kpiModel";

export interface KpiTemplate {
  id: string;
  name: string;
  description: string;
  requiredData: string;
  definition: Partial<KpiDefinitionInput>;
  condition: KpiCondition;
}

export interface KpiPack {
  id: string;
  name: string;
  description: string;
  requiredData: string;
  templates: KpiTemplate[];
}

type Copy = { name: string; description: string; requiredData: string };
type TemplateSeed = {
  id: CopyKey;
  definition: Partial<KpiDefinitionInput>;
  condition: KpiCondition;
};

const en = {
  sales: {
    name: "Sales & acquisition",
    description: "Balance commercial outcomes, conversion and follow-up discipline.",
    requiredData: "CRM deals and activities; reliable closure dates and deal values.",
  },
  agency: {
    name: "Consulting & agencies",
    description: "Keep delivery quality, capacity and project economics in view.",
    requiredData:
      "Approved manual measurements from projects, time, direct costs and client feedback.",
  },
  recurring: {
    name: "Recurring services",
    description: "Measure the health of customer relationships and recurring business.",
    requiredData: "Approved manual measurements from contracts, subscriptions and billing.",
  },
  support: {
    name: "Support & maintenance",
    description: "Track service speed, reliability and commitments to customers.",
    requiredData: "Approved manual measurements from tickets, service commitments and incidents.",
  },
  product: {
    name: "Product businesses",
    description: "Connect sales volume with margin and fulfilment quality.",
    requiredData: "Approved manual measurements from orders, costs, returns and deliveries.",
  },
  marketing: {
    name: "Marketing",
    description: "Connect acquisition activity to qualified demand and conversion.",
    requiredData: "Approved manual measurements from attribution, spend and conversion events.",
  },
  won_value: {
    name: "Won deal value",
    description:
      "Sum of won deal values by closure date. This is booked deal value, not invoiced revenue, cash or profit.",
    requiredData: "Won CRM deals with a closure date and value in the selected currency.",
  },
  win_rate: {
    name: "Win rate",
    description:
      "Won deals divided by all won and lost deals closed in the period. Open deals are excluded.",
    requiredData:
      "Won and lost CRM deals with reliable closure dates. No closed deals means unavailable.",
  },
  sales_cycle: {
    name: "Median sales cycle",
    description: "Median days from deal creation to closure for closed deals in the period.",
    requiredData:
      "Closed CRM deals with valid creation and closure dates; missing dates are excluded.",
  },
  overdue_followups: {
    name: "Overdue follow-ups",
    description:
      "Open activities due in the period that are overdue at evaluation time. Zero is the desired result.",
    requiredData:
      "CRM activities with due dates and completion status. Evaluation uses the selected scope.",
  },
  qualified_opportunities: {
    name: "Qualified opportunities",
    description:
      "Count opportunities meeting your documented qualification criteria during the period.",
    requiredData: "An agreed qualification rule and a reviewed list of qualifying opportunities.",
  },
  on_time_acceptance: {
    name: "On-time acceptance",
    description:
      "Milestones accepted by their deadline divided by all eligible milestones due in the period; overdue unaccepted milestones remain in the denominator.",
    requiredData:
      "Milestone due dates, acceptance records and the eligible milestone count; report the denominator as sample size.",
  },
  project_margin: {
    name: "Project gross margin",
    description:
      "Project revenue less defined direct costs, divided by project revenue. Agree the revenue and cost basis before reporting.",
    requiredData:
      "Matched project revenue and direct costs on a consistent accounting basis. Zero revenue is unavailable.",
  },
  utilisation: {
    name: "Billable utilisation",
    description:
      "Approved billable hours divided by available working hours, adjusted for leave and agreed non-working time.",
    requiredData:
      "Approved timesheets, working schedules and leave records; report available hours in the source note.",
  },
  rework: {
    name: "Revision rounds",
    description:
      "Average revision rounds per eligible deliverable, using an agreed definition of a revision round.",
    requiredData:
      "Reviewed revision records and eligible deliverable count; report that count as sample size.",
  },
  satisfaction: {
    name: "Client satisfaction",
    description:
      "Average client survey rating on an agreed five-point scale, with the response count visible.",
    requiredData:
      "Comparable survey responses on a 1–5 scale; report response count as sample size.",
  },
  renewal_rate: {
    name: "Renewal rate",
    description: "Contracts renewed divided by eligible contracts reaching renewal in the period.",
    requiredData:
      "Contract renewal dates, eligibility rules and renewal outcomes; report eligible contracts as sample size.",
  },
  retention: {
    name: "Customer retention",
    description:
      "Customers active at period start who remain active at period end, divided by customers active at period start.",
    requiredData:
      "A defined customer cohort and consistent active-customer rules; report starting cohort size.",
  },
  recurring_revenue: {
    name: "Monthly recurring revenue",
    description:
      "Recurring contracted charges normalised to one month, excluding one-off fees and agreed exclusions.",
    requiredData:
      "A reviewed period-end subscription or contract schedule in the selected currency; document exclusions.",
  },
  expansion: {
    name: "Expansion revenue",
    description:
      "Additional recurring monthly value from existing customers during the period, using an agreed upgrade basis.",
    requiredData:
      "Reviewed existing-customer upgrades in the selected currency; distinguish contracted value from cash collected.",
  },
  first_response: {
    name: "First-response time",
    description:
      "Median hours from eligible ticket creation to the first qualifying response, using an agreed business-hours policy.",
    requiredData:
      "Ticket timestamps, qualifying response rules and service calendar; report eligible ticket count as sample size.",
  },
  resolution: {
    name: "Resolution time",
    description:
      "Median hours to resolve eligible tickets, with a documented policy for pauses and reopened tickets.",
    requiredData:
      "Reviewed ticket lifecycle timestamps and pause rules; report resolved ticket count as sample size.",
  },
  sla: {
    name: "SLA compliance",
    description:
      "Eligible service commitments met divided by all eligible commitments due, including overdue unresolved work.",
    requiredData:
      "Service targets, deadlines and outcomes; report all eligible commitments due as sample size.",
  },
  repeat_incidents: {
    name: "Repeat incidents",
    description: "Count incidents classified as repeats under your documented recurrence rule.",
    requiredData:
      "Reviewed incident history and an agreed recurrence window and classification rule.",
  },
  units: {
    name: "Units sold",
    description:
      "Net units sold under the agreed order-status and cancellation policy for the period.",
    requiredData:
      "Reviewed order lines, quantities and cancellation rules; document the sales date used.",
  },
  gross_margin: {
    name: "Product gross margin",
    description: "Product revenue less defined cost of goods sold, divided by product revenue.",
    requiredData:
      "Matched product revenue and cost records on a consistent basis. Zero revenue is unavailable.",
  },
  returns: {
    name: "Return rate",
    description:
      "Returned units divided by eligible sold units in a defined sales cohort and return window.",
    requiredData:
      "Matched order and return records with a cohort and return window; report eligible units as sample size.",
  },
  fulfilment: {
    name: "On-time fulfilment",
    description:
      "Orders fulfilled by their promised deadline divided by all eligible orders due, including overdue unfulfilled orders.",
    requiredData:
      "Promised deadlines and fulfilment records; report eligible orders due as sample size.",
  },
  sourced_opportunities: {
    name: "Qualified opportunities by source",
    description:
      "Count qualified opportunities attributed to an explicitly selected acquisition source.",
    requiredData:
      "Reviewed qualification and attribution records; name the source and attribution rule in the source note.",
  },
  acquisition_cost: {
    name: "Customer acquisition cost",
    description:
      "Agreed acquisition spend divided by newly acquired customers in a matched period or cohort.",
    requiredData:
      "Reviewed spend and new-customer records in the selected currency; zero customers is unavailable.",
  },
  campaign_conversion: {
    name: "Campaign conversion",
    description:
      "Defined campaign conversions divided by the eligible attributed audience or interactions.",
    requiredData:
      "A named campaign, conversion event and denominator; report denominator count as sample size.",
  },
} satisfies Record<string, Copy>;

type CopyKey = keyof typeof en;
const copy: Record<Locale, Record<CopyKey, Copy>> = {
  en,
  de: {
    sales: {
      name: "Vertrieb & Akquise",
      description: "Geschäftsergebnisse, Abschlussquote und verlässliche Nachverfolgung verbinden.",
      requiredData: "CRM-Deals und Aktivitäten mit verlässlichen Abschlussdaten und Dealwerten.",
    },
    agency: {
      name: "Beratung & Agenturen",
      description: "Lieferqualität, Kapazität und Projektwirtschaftlichkeit im Blick behalten.",
      requiredData:
        "Freigegebene manuelle Messwerte aus Projekten, Zeiterfassung, direkten Kosten und Kundenfeedback.",
    },
    recurring: {
      name: "Wiederkehrende Leistungen",
      description: "Kundenbindung und wiederkehrendes Geschäft bewerten.",
      requiredData: "Freigegebene manuelle Messwerte aus Verträgen, Abonnements und Abrechnung.",
    },
    support: {
      name: "Support & Wartung",
      description: "Servicegeschwindigkeit, Zuverlässigkeit und Kundenzusagen verfolgen.",
      requiredData: "Freigegebene manuelle Messwerte aus Tickets, Servicezusagen und Vorfällen.",
    },
    product: {
      name: "Produktgeschäft",
      description: "Absatz mit Marge und Lieferqualität verbinden.",
      requiredData:
        "Freigegebene manuelle Messwerte aus Bestellungen, Kosten, Retouren und Lieferungen.",
    },
    marketing: {
      name: "Marketing",
      description: "Akquiseaktivitäten mit qualifizierter Nachfrage und Konversion verbinden.",
      requiredData:
        "Freigegebene manuelle Messwerte aus Attribution, Ausgaben und Konversionsereignissen.",
    },
    won_value: {
      name: "Gewonnener Dealwert",
      description:
        "Summe gewonnener Dealwerte nach Abschlussdatum. Dies ist gebuchter Dealwert, kein fakturierter Umsatz, Zahlungseingang oder Gewinn.",
      requiredData: "Gewonnene CRM-Deals mit Abschlussdatum und Wert in der ausgewählten Währung.",
    },
    win_rate: {
      name: "Abschlussquote",
      description:
        "Gewonnene Deals geteilt durch alle im Zeitraum gewonnenen und verlorenen Deals. Offene Deals bleiben unberücksichtigt.",
      requiredData:
        "Gewonnene und verlorene CRM-Deals mit verlässlichem Abschlussdatum. Ohne abgeschlossene Deals ist kein Wert verfügbar.",
    },
    sales_cycle: {
      name: "Median des Vertriebszyklus",
      description:
        "Median der Tage von der Erstellung bis zum Abschluss für im Zeitraum abgeschlossene Deals.",
      requiredData:
        "Abgeschlossene CRM-Deals mit gültigem Erstellungs- und Abschlussdatum; fehlende Datumswerte werden ausgeschlossen.",
    },
    overdue_followups: {
      name: "Überfällige Nachfassaktivitäten",
      description:
        "Im Zeitraum fällige offene Aktivitäten, die zum Auswertungszeitpunkt überfällig sind. Null ist das gewünschte Ergebnis.",
      requiredData:
        "CRM-Aktivitäten mit Fälligkeit und Erledigungsstatus. Die Auswertung verwendet den gewählten Geltungsbereich.",
    },
    qualified_opportunities: {
      name: "Qualifizierte Verkaufschancen",
      description:
        "Anzahl der Verkaufschancen, die im Zeitraum die dokumentierten Qualifikationskriterien erfüllen.",
      requiredData:
        "Eine vereinbarte Qualifikationsregel und eine geprüfte Liste geeigneter Verkaufschancen.",
    },
    on_time_acceptance: {
      name: "Fristgerechte Abnahme",
      description:
        "Fristgerecht abgenommene Meilensteine geteilt durch alle im Zeitraum fälligen relevanten Meilensteine; überfällige nicht abgenommene Meilensteine bleiben im Nenner.",
      requiredData:
        "Fälligkeiten, Abnahmebelege und Anzahl relevanter Meilensteine; den Nenner als Stichprobengröße angeben.",
    },
    project_margin: {
      name: "Projektrohmarge",
      description:
        "Projektumsatz abzüglich definierter direkter Kosten, geteilt durch den Projektumsatz. Umsatz- und Kostenbasis vorab vereinbaren.",
      requiredData:
        "Zugeordneter Projektumsatz und direkte Kosten auf einheitlicher Grundlage. Bei null Umsatz ist kein Wert verfügbar.",
    },
    utilisation: {
      name: "Fakturierbare Auslastung",
      description:
        "Freigegebene fakturierbare Stunden geteilt durch verfügbare Arbeitsstunden, bereinigt um Urlaub und vereinbarte arbeitsfreie Zeiten.",
      requiredData:
        "Freigegebene Zeiterfassung, Arbeitspläne und Abwesenheiten; verfügbare Stunden im Quellenhinweis angeben.",
    },
    rework: {
      name: "Korrekturschleifen",
      description:
        "Durchschnittliche Korrekturschleifen je relevantem Arbeitsergebnis nach einer vereinbarten Definition.",
      requiredData:
        "Geprüfte Korrekturprotokolle und Anzahl relevanter Arbeitsergebnisse; diese Anzahl als Stichprobengröße angeben.",
    },
    satisfaction: {
      name: "Kundenzufriedenheit",
      description:
        "Durchschnittliche Kundenbewertung auf einer vereinbarten Fünf-Punkte-Skala mit sichtbarer Antwortzahl.",
      requiredData:
        "Vergleichbare Umfrageantworten auf einer Skala von 1–5; Antwortzahl als Stichprobengröße angeben.",
    },
    renewal_rate: {
      name: "Verlängerungsquote",
      description:
        "Verlängerte Verträge geteilt durch alle im Zeitraum zur Verlängerung anstehenden relevanten Verträge.",
      requiredData:
        "Verlängerungsdaten, Relevanzregeln und Ergebnisse; relevante Verträge als Stichprobengröße angeben.",
    },
    retention: {
      name: "Kundenbindungsquote",
      description:
        "Zu Periodenbeginn aktive und am Periodenende weiterhin aktive Kunden, geteilt durch alle zu Periodenbeginn aktiven Kunden.",
      requiredData:
        "Eine definierte Kundenkohorte und einheitliche Aktivitätsregeln; Ausgangsgröße der Kohorte angeben.",
    },
    recurring_revenue: {
      name: "Monatlich wiederkehrender Umsatz",
      description:
        "Vertraglich wiederkehrende Entgelte auf einen Monat normiert, ohne Einmalentgelte und vereinbarte Ausnahmen.",
      requiredData:
        "Geprüfter Abonnement- oder Vertragsbestand zum Periodenende in der ausgewählten Währung; Ausnahmen dokumentieren.",
    },
    expansion: {
      name: "Expansionsumsatz",
      description:
        "Zusätzlicher monatlich wiederkehrender Wert bestehender Kunden im Zeitraum nach einer vereinbarten Upgrade-Grundlage.",
      requiredData:
        "Geprüfte Bestandskunden-Upgrades in der ausgewählten Währung; Vertragswert von Zahlungseingängen unterscheiden.",
    },
    first_response: {
      name: "Erstreaktionszeit",
      description:
        "Median der Stunden von der Erstellung relevanter Tickets bis zur ersten qualifizierenden Antwort nach vereinbarter Geschäftszeitenregel.",
      requiredData:
        "Ticketzeitstempel, Antwortregeln und Servicekalender; relevante Ticketanzahl als Stichprobengröße angeben.",
    },
    resolution: {
      name: "Lösungszeit",
      description:
        "Median der Stunden bis zur Lösung relevanter Tickets mit dokumentierter Regel für Pausen und wiedereröffnete Tickets.",
      requiredData:
        "Geprüfte Ticketzeitstempel und Pausenregeln; Anzahl gelöster Tickets als Stichprobengröße angeben.",
    },
    sla: {
      name: "SLA-Einhaltung",
      description:
        "Eingehaltene relevante Servicezusagen geteilt durch alle fälligen relevanten Zusagen, einschließlich überfälliger offener Arbeit.",
      requiredData:
        "Serviceziele, Fristen und Ergebnisse; alle fälligen relevanten Zusagen als Stichprobengröße angeben.",
    },
    repeat_incidents: {
      name: "Wiederholte Vorfälle",
      description:
        "Anzahl der nach dokumentierter Wiederholungsregel als erneut auftretend eingestuften Vorfälle.",
      requiredData:
        "Geprüfte Vorfallhistorie und vereinbartes Wiederholungsfenster mit Klassifikationsregel.",
    },
    units: {
      name: "Verkaufte Einheiten",
      description:
        "Netto verkaufte Einheiten im Zeitraum nach vereinbarten Regeln für Bestellstatus und Stornierungen.",
      requiredData:
        "Geprüfte Bestellpositionen, Mengen und Stornoregeln; verwendetes Verkaufsdatum dokumentieren.",
    },
    gross_margin: {
      name: "Produktrohmarge",
      description:
        "Produktumsatz abzüglich definierter Herstellungskosten, geteilt durch den Produktumsatz.",
      requiredData:
        "Zugeordnete Produktumsatz- und Kostendaten auf einheitlicher Grundlage. Bei null Umsatz ist kein Wert verfügbar.",
    },
    returns: {
      name: "Retourenquote",
      description:
        "Retournierte Einheiten geteilt durch relevante verkaufte Einheiten einer definierten Verkaufskohorte innerhalb des Retourenfensters.",
      requiredData:
        "Zugeordnete Bestell- und Retourendaten mit Kohorte und Retourenfenster; relevante Einheiten als Stichprobengröße angeben.",
    },
    fulfilment: {
      name: "Fristgerechte Erfüllung",
      description:
        "Fristgerecht erfüllte Bestellungen geteilt durch alle fälligen relevanten Bestellungen, einschließlich überfälliger unerfüllter Bestellungen.",
      requiredData:
        "Zugesagte Fristen und Erfüllungsbelege; fällige relevante Bestellungen als Stichprobengröße angeben.",
    },
    sourced_opportunities: {
      name: "Qualifizierte Chancen nach Quelle",
      description:
        "Anzahl qualifizierter Verkaufschancen, die einer ausdrücklich gewählten Akquisequelle zugeordnet sind.",
      requiredData:
        "Geprüfte Qualifikations- und Attributionsdaten; Quelle und Zuordnungsregel im Quellenhinweis nennen.",
    },
    acquisition_cost: {
      name: "Kundenakquisitionskosten",
      description:
        "Vereinbarte Akquiseausgaben geteilt durch neu gewonnene Kunden eines passenden Zeitraums oder einer Kohorte.",
      requiredData:
        "Geprüfte Ausgaben und Neukundendaten in der ausgewählten Währung; ohne Neukunden ist kein Wert verfügbar.",
    },
    campaign_conversion: {
      name: "Kampagnenkonversion",
      description:
        "Definierte Kampagnenkonversionen geteilt durch die relevante zugeordnete Zielgruppe oder Interaktionen.",
      requiredData:
        "Benannte Kampagne, Konversionsereignis und Nenner; Anzahl im Nenner als Stichprobengröße angeben.",
    },
  },
  fa: {
    sales: {
      name: "فروش و جذب مشتری",
      description: "نتایج تجاری، نرخ تبدیل و پیگیری منظم را کنار هم بسنجید.",
      requiredData: "معاملات و فعالیت‌های CRM با تاریخ اختتام و ارزش معتبر.",
    },
    agency: {
      name: "مشاوره و آژانس‌ها",
      description: "کیفیت تحویل، ظرفیت و اقتصاد پروژه را در نظر بگیرید.",
      requiredData: "اندازه‌گیری دستی تأییدشده از پروژه‌ها، زمان، هزینه مستقیم و بازخورد مشتری.",
    },
    recurring: {
      name: "خدمات تکرارشونده",
      description: "سلامت رابطه با مشتری و کسب‌وکار تکرارشونده را بسنجید.",
      requiredData: "اندازه‌گیری دستی تأییدشده از قراردادها، اشتراک‌ها و صورتحساب‌ها.",
    },
    support: {
      name: "پشتیبانی و نگهداری",
      description: "سرعت خدمت، قابلیت اتکا و تعهدات به مشتری را پیگیری کنید.",
      requiredData: "اندازه‌گیری دستی تأییدشده از تیکت‌ها، تعهدات خدمات و رخدادها.",
    },
    product: {
      name: "کسب‌وکارهای محصولی",
      description: "حجم فروش را با حاشیه سود و کیفیت تحویل مرتبط کنید.",
      requiredData: "اندازه‌گیری دستی تأییدشده از سفارش‌ها، هزینه‌ها، مرجوعی‌ها و تحویل‌ها.",
    },
    marketing: {
      name: "بازاریابی",
      description: "فعالیت جذب را به تقاضای واجد شرایط و تبدیل مرتبط کنید.",
      requiredData: "اندازه‌گیری دستی تأییدشده از انتساب، هزینه و رویدادهای تبدیل.",
    },
    won_value: {
      name: "ارزش معاملات موفق",
      description:
        "مجموع ارزش معاملات موفق بر اساس تاریخ اختتام. این ارزش قرارداد است، نه درآمد صورتحساب‌شده، وجه دریافتی یا سود.",
      requiredData: "معاملات موفق CRM با تاریخ اختتام و ارزش به ارز انتخاب‌شده.",
    },
    win_rate: {
      name: "نرخ موفقیت فروش",
      description:
        "معاملات موفق تقسیم بر همه معاملات موفق و ناموفق مختومه در دوره. معاملات باز محاسبه نمی‌شوند.",
      requiredData:
        "معاملات موفق و ناموفق CRM با تاریخ اختتام معتبر. بدون معامله مختومه، مقدار در دسترس نیست.",
    },
    sales_cycle: {
      name: "میانه چرخه فروش",
      description: "میانه تعداد روزها از ایجاد تا اختتام برای معاملات مختومه در دوره.",
      requiredData: "معاملات مختومه CRM با تاریخ ایجاد و اختتام معتبر؛ تاریخ‌های ناقص حذف می‌شوند.",
    },
    overdue_followups: {
      name: "پیگیری‌های عقب‌افتاده",
      description:
        "فعالیت‌های باز با سررسید در دوره که هنگام ارزیابی عقب‌افتاده‌اند. نتیجه مطلوب صفر است.",
      requiredData:
        "فعالیت‌های CRM با سررسید و وضعیت تکمیل. ارزیابی در محدوده انتخاب‌شده انجام می‌شود.",
    },
    qualified_opportunities: {
      name: "فرصت‌های واجد شرایط",
      description: "تعداد فرصت‌هایی که در دوره معیارهای مستند احراز صلاحیت را دارند.",
      requiredData: "قاعده توافق‌شده احراز صلاحیت و فهرست بازبینی‌شده فرصت‌های واجد شرایط.",
    },
    on_time_acceptance: {
      name: "پذیرش به‌موقع",
      description:
        "نقاط عطف پذیرفته‌شده تا مهلت تقسیم بر همه نقاط عطف واجد شرایط با سررسید در دوره؛ موارد عقب‌افتاده پذیرفته‌نشده در مخرج باقی می‌مانند.",
      requiredData:
        "سررسید نقاط عطف، سوابق پذیرش و تعداد موارد واجد شرایط؛ مخرج را به‌عنوان اندازه نمونه ثبت کنید.",
    },
    project_margin: {
      name: "حاشیه سود ناخالص پروژه",
      description:
        "درآمد پروژه منهای هزینه مستقیم تعریف‌شده، تقسیم بر درآمد پروژه. مبنای درآمد و هزینه را پیش از گزارش توافق کنید.",
      requiredData:
        "درآمد و هزینه مستقیم متناظر پروژه با مبنای یکسان. با درآمد صفر، مقدار در دسترس نیست.",
    },
    utilisation: {
      name: "بهره‌برداری قابل صورتحساب",
      description:
        "ساعات تأییدشده قابل صورتحساب تقسیم بر ساعات کاری در دسترس، با کسر مرخصی و زمان غیرکاری توافق‌شده.",
      requiredData:
        "گزارش زمان تأییدشده، برنامه کار و مرخصی؛ ساعات در دسترس را در یادداشت منبع بنویسید.",
    },
    rework: {
      name: "دورهای بازبینی",
      description:
        "میانگین دورهای اصلاح به‌ازای هر خروجی واجد شرایط، بر اساس تعریف توافق‌شده هر دور.",
      requiredData:
        "سوابق بازبینی‌شده اصلاح و تعداد خروجی‌های واجد شرایط؛ این تعداد را اندازه نمونه قرار دهید.",
    },
    satisfaction: {
      name: "رضایت مشتری",
      description:
        "میانگین امتیاز نظرسنجی مشتری در مقیاس توافق‌شده پنج‌امتیازی، با تعداد پاسخ‌های قابل مشاهده.",
      requiredData:
        "پاسخ‌های قابل مقایسه در مقیاس ۱ تا ۵؛ تعداد پاسخ‌ها را به‌عنوان اندازه نمونه ثبت کنید.",
    },
    renewal_rate: {
      name: "نرخ تمدید",
      description:
        "قراردادهای تمدیدشده تقسیم بر قراردادهای واجد شرایطی که در دوره به موعد تمدید می‌رسند.",
      requiredData:
        "تاریخ تمدید، قواعد واجد شرایط بودن و نتیجه تمدید؛ تعداد قراردادهای واجد شرایط را اندازه نمونه قرار دهید.",
    },
    retention: {
      name: "حفظ مشتری",
      description:
        "مشتریان فعال ابتدای دوره که در پایان دوره فعال مانده‌اند، تقسیم بر مشتریان فعال ابتدای دوره.",
      requiredData: "گروه مشخص مشتریان و قواعد یکسان فعالیت؛ اندازه گروه در آغاز را ثبت کنید.",
    },
    recurring_revenue: {
      name: "درآمد تکرارشونده ماهانه",
      description:
        "مبالغ تکرارشونده قراردادی نرمال‌شده به یک ماه، بدون هزینه‌های یک‌باره و استثناهای توافق‌شده.",
      requiredData:
        "فهرست بازبینی‌شده اشتراک یا قرارداد در پایان دوره به ارز انتخاب‌شده؛ استثناها را مستند کنید.",
    },
    expansion: {
      name: "درآمد توسعه مشتری",
      description:
        "ارزش ماهانه تکرارشونده افزوده از مشتریان موجود در دوره، بر اساس مبنای توافق‌شده ارتقا.",
      requiredData:
        "ارتقاهای بازبینی‌شده مشتریان موجود به ارز انتخاب‌شده؛ ارزش قرارداد را از وجه دریافتی متمایز کنید.",
    },
    first_response: {
      name: "زمان اولین پاسخ",
      description:
        "میانه ساعت از ایجاد تیکت واجد شرایط تا اولین پاسخ معتبر، بر اساس سیاست توافق‌شده ساعات کاری.",
      requiredData:
        "زمان‌های تیکت، قواعد پاسخ معتبر و تقویم خدمات؛ تعداد تیکت‌های واجد شرایط را اندازه نمونه قرار دهید.",
    },
    resolution: {
      name: "زمان حل مسئله",
      description: "میانه ساعت تا حل تیکت‌های واجد شرایط با سیاست مستند توقف و بازگشایی تیکت.",
      requiredData:
        "زمان‌های بازبینی‌شده چرخه تیکت و قواعد توقف؛ تعداد تیکت‌های حل‌شده را اندازه نمونه قرار دهید.",
    },
    sla: {
      name: "رعایت توافق‌نامه سطح خدمات",
      description:
        "تعهدات خدمات انجام‌شده تقسیم بر همه تعهدات واجد شرایط سررسیدشده، شامل کارهای عقب‌افتاده حل‌نشده.",
      requiredData:
        "اهداف خدمات، مهلت‌ها و نتایج؛ همه تعهدات واجد شرایط سررسیدشده را اندازه نمونه قرار دهید.",
    },
    repeat_incidents: {
      name: "رخدادهای تکراری",
      description: "تعداد رخدادهایی که بر اساس قاعده مستند تکرار، تکراری طبقه‌بندی شده‌اند.",
      requiredData: "سوابق بازبینی‌شده رخداد و بازه تکرار و قاعده طبقه‌بندی توافق‌شده.",
    },
    units: {
      name: "واحدهای فروخته‌شده",
      description: "خالص واحدهای فروخته‌شده در دوره بر اساس قواعد توافق‌شده وضعیت سفارش و لغو.",
      requiredData:
        "ردیف‌های سفارش، تعداد و قواعد لغو بازبینی‌شده؛ تاریخ فروش استفاده‌شده را مستند کنید.",
    },
    gross_margin: {
      name: "حاشیه سود ناخالص محصول",
      description: "درآمد محصول منهای بهای تمام‌شده تعریف‌شده، تقسیم بر درآمد محصول.",
      requiredData: "درآمد و هزینه متناظر محصول با مبنای یکسان. با درآمد صفر، مقدار در دسترس نیست.",
    },
    returns: {
      name: "نرخ مرجوعی",
      description:
        "واحدهای مرجوعی تقسیم بر واحدهای فروخته‌شده واجد شرایط در گروه فروش و بازه مرجوعی مشخص.",
      requiredData:
        "سوابق متناظر سفارش و مرجوعی با گروه و بازه مشخص؛ واحدهای واجد شرایط را اندازه نمونه قرار دهید.",
    },
    fulfilment: {
      name: "اجرای به‌موقع سفارش",
      description:
        "سفارش‌های اجراشده تا مهلت تعهد تقسیم بر همه سفارش‌های واجد شرایط سررسیدشده، شامل سفارش‌های عقب‌افتاده اجرا‌نشده.",
      requiredData:
        "مهلت‌های تعهد و سوابق اجرا؛ سفارش‌های واجد شرایط سررسیدشده را اندازه نمونه قرار دهید.",
    },
    sourced_opportunities: {
      name: "فرصت‌های واجد شرایط به تفکیک منبع",
      description: "تعداد فرصت‌های واجد شرایط منتسب به منبع جذب صریحاً انتخاب‌شده.",
      requiredData:
        "سوابق بازبینی‌شده صلاحیت و انتساب؛ منبع و قاعده انتساب را در یادداشت منبع نام ببرید.",
    },
    acquisition_cost: {
      name: "هزینه جذب مشتری",
      description: "هزینه توافق‌شده جذب تقسیم بر مشتریان تازه جذب‌شده در دوره یا گروه متناظر.",
      requiredData:
        "هزینه و سوابق مشتریان جدید بازبینی‌شده به ارز انتخاب‌شده؛ بدون مشتری جدید مقدار در دسترس نیست.",
    },
    campaign_conversion: {
      name: "تبدیل کمپین",
      description: "تبدیل‌های تعریف‌شده کمپین تقسیم بر مخاطبان یا تعاملات منتسب واجد شرایط.",
      requiredData: "کمپین، رویداد تبدیل و مخرج مشخص؛ تعداد مخرج را به‌عنوان اندازه نمونه ثبت کنید.",
    },
  },
};

function manual(
  id: CopyKey,
  unit: KpiUnit,
  target: string,
  kind: KpiCondition["kind"] = "at_least",
  upperTarget?: string,
): TemplateSeed {
  return {
    id,
    definition: {
      source: "manual",
      calculation: "average",
      dateField: "measured",
      unit,
      filters: {},
    },
    condition: { kind, target, ...(upperTarget === undefined ? {} : { upperTarget }) },
  };
}

const packs: { id: CopyKey; templates: TemplateSeed[] }[] = [
  {
    id: "sales",
    templates: [
      {
        id: "won_value",
        definition: {
          source: "deals",
          calculation: "sum",
          unit: "money",
          dateField: "closed",
          valueField: "value",
          filters: { status: "won" },
        },
        condition: { kind: "at_least", target: "10000" },
      },
      {
        id: "win_rate",
        definition: {
          source: "deals",
          calculation: "percentage",
          unit: "percent",
          dateField: "closed",
          numeratorStatus: "won",
          denominatorStatus: "closed",
          filters: { status: "all" },
        },
        condition: { kind: "at_least", target: "30" },
      },
      {
        id: "sales_cycle",
        definition: {
          source: "deals",
          calculation: "median",
          unit: "days",
          dateField: "closed",
          valueField: "sales_cycle",
          filters: { status: "closed" },
        },
        condition: { kind: "at_most", target: "30" },
      },
      {
        id: "overdue_followups",
        definition: {
          source: "activities",
          calculation: "count",
          unit: "count",
          dateField: "due",
          filters: { status: "overdue" },
        },
        condition: { kind: "at_most", target: "0" },
      },
      manual("qualified_opportunities", "count", "10"),
    ],
  },
  {
    id: "agency",
    templates: [
      manual("on_time_acceptance", "percent", "95"),
      manual("project_margin", "percent", "35"),
      manual("utilisation", "percent", "60", "range", "75"),
      manual("rework", "count", "2", "at_most"),
      manual("satisfaction", "custom", "4.5"),
    ],
  },
  {
    id: "recurring",
    templates: [
      manual("renewal_rate", "percent", "90"),
      manual("retention", "percent", "95"),
      manual("recurring_revenue", "money", "10000"),
      manual("expansion", "money", "1000"),
    ],
  },
  {
    id: "support",
    templates: [
      manual("first_response", "hours", "1", "at_most"),
      manual("resolution", "hours", "24", "at_most"),
      manual("sla", "percent", "95"),
      manual("repeat_incidents", "count", "0", "at_most"),
    ],
  },
  {
    id: "product",
    templates: [
      manual("units", "count", "100"),
      manual("gross_margin", "percent", "35"),
      manual("returns", "percent", "5", "at_most"),
      manual("fulfilment", "percent", "95"),
    ],
  },
  {
    id: "marketing",
    templates: [
      manual("sourced_opportunities", "count", "10"),
      manual("acquisition_cost", "money", "500", "at_most"),
      manual("campaign_conversion", "percent", "5"),
    ],
  },
];

const manualNotice: Record<Locale, string> = {
  en: "Enter one approved observation for the whole reporting period, with a source note. This template does not connect to the source system; multiple observations are averaged equally.",
  de: "Einen freigegebenen Messwert für den gesamten Berichtszeitraum mit Quellenhinweis erfassen. Diese Vorlage verbindet kein Quellsystem; mehrere Messwerte werden gleich gewichtet gemittelt.",
  fa: "یک مشاهده تأییدشده برای کل دوره گزارش همراه یادداشت منبع ثبت کنید. این الگو به سامانه منبع متصل نمی‌شود؛ چند مشاهده با وزن برابر میانگین‌گیری می‌شوند.",
};

/** Starting points only: targets are editable and external sources require approved observations. */
export function kpiPacks(locale: Locale, baseCurrency: string): KpiPack[] {
  const labels = copy[locale];
  return packs.map((pack) => ({
    id: pack.id,
    ...labels[pack.id],
    templates: pack.templates.map((template) => {
      const label = labels[template.id];
      return {
        id: template.id,
        ...label,
        requiredData:
          template.definition.source === "manual"
            ? `${manualNotice[locale]} ${label.requiredData}`
            : label.requiredData,
        definition: {
          ...template.definition,
          name: label.name,
          description: label.description,
          ...(template.definition.unit === "money" ? { currency: baseCurrency } : {}),
          ...(template.id === "satisfaction"
            ? { customUnit: { en: "points / 5", de: "Punkte / 5", fa: "امتیاز از ۵" }[locale] }
            : {}),
          filters: { ...template.definition.filters },
        },
        condition: { ...template.condition },
      };
    }),
  }));
}
