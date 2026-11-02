import { criterion, originalDefinition } from "./catalogAuthoring";

export const buyingReadiness = originalDefinition(
  "buying-readiness",
  ["آمادگی خرید", "Kaufbereitschaft prüfen", "Buying readiness"],
  [
    "نیاز، منابع و مسیر تصمیم مشتری را بدون فرض آمادگی خرید روشن کنید.",
    "Klären Sie Bedarf, Mittel und Entscheidungsweg, ohne Kaufbereitschaft vorauszusetzen.",
    "Clarify customer needs, resources and decisions without assuming readiness to buy.",
  ],
  "BANT",
  "https://public.dhe.ibm.com/software/pdf/tr/SAMPLE-BANT_for_XYZ_Company_1JF-XXXXXX.pdf",
  [
    criterion(
      "funding-constraints",
      ["منابع مالی", "Finanzielle Mittel", "Funding constraints"],
      [
        "منابع تأییدشده را از برآورد و محدودیت‌ها جدا کنید.",
        "Trennen Sie bestätigte Mittel von Schätzungen und Grenzen.",
        "Separate confirmed resources from estimates and constraints.",
      ],
      [
        "چه منبعی وضعیت تأمین مالی و محدودیت‌های آن را روشن می‌کند؟",
        "Welche Quelle belegt verfügbare Mittel und deren Grenzen?",
        "What source clarifies funding availability and its limits?",
      ],
    ),
    criterion(
      "approval-participants",
      ["افراد تصمیم‌گیر", "Beteiligte an der Freigabe", "Approval participants"],
      [
        "نقش مشورت و اختیار تأیید را جداگانه روشن کنید.",
        "Unterscheiden Sie Beratung und Befugnis zur Freigabe.",
        "Distinguish consultation from authority to approve.",
      ],
      [
        "چه کسانی می‌توانند خرید را تأیید کنند و این نقش چگونه تأیید شده است؟",
        "Wer darf den Kauf freigeben und wie wurde diese Rolle bestätigt?",
        "Who can approve the purchase, and how was that role confirmed?",
      ],
    ),
    criterion(
      "customer-need",
      ["نیاز مشتری", "Kundenbedarf", "Customer need"],
      [
        "نیاز بیان‌شدهٔ مشتری را از برداشت فروشنده جدا کنید.",
        "Trennen Sie den geäußerten Kundenbedarf von Ihrer Interpretation.",
        "Separate the customer's stated need from seller interpretation.",
      ],
      [
        "مشتری چه مشکلی را بیان کرده و کدام منبع آن را پشتیبانی می‌کند؟",
        "Welches Problem nennt der Kunde und welche Quelle stützt es?",
        "What problem has the customer described, and what supports it?",
      ],
    ),
    criterion(
      "buyer-timing",
      ["زمان‌بندی مشتری", "Zeitplanung des Kunden", "Buyer timing"],
      [
        "تاریخ مشتری و میزان قطعیت آن را از هدف فروش جدا کنید.",
        "Trennen Sie Kundentermine und deren Sicherheit vom Vertriebsziel.",
        "Keep buyer dates and their certainty separate from the seller's target.",
      ],
      [
        "کدام رویداد مشتری بر زمان تصمیم اثر دارد و چه چیزی هنوز نامشخص است؟",
        "Welches Kundenereignis prägt den Termin und was bleibt offen?",
        "Which customer milestone shapes the decision date, and what remains uncertain?",
      ],
    ),
  ],
);
