import { criterion, originalDefinition } from "./catalogAuthoring";

export const commercialHypothesis = originalDefinition(
  "commercial-hypothesis",
  ["فرضیهٔ تجاری", "Geschäftliche Hypothese", "Commercial hypothesis"],
  [
    "یک برداشت پیشنهادی را با منبع و پاسخ مشتری بررسی کنید؛ مخالفت نیز اطلاعات است.",
    "Prüfen Sie eine mögliche Sichtweise mit Quelle und Kundenreaktion; Widerspruch zählt ebenfalls.",
    "Review a proposed perspective with its source and the customer's response, including disagreement.",
  ],
  "Challenger",
  "https://challengerinc.com/what-is-challenger-sales-methodology/",
  [
    criterion(
      "hypothesis-source",
      ["منبع فرضیه", "Quelle der Hypothese", "Hypothesis source"],
      [
        "فرضیهٔ فروشنده را از واقعیت تأییدشدهٔ مشتری جدا کنید.",
        "Trennen Sie Ihre Hypothese von bestätigten Kundenfakten.",
        "Keep a seller hypothesis distinct from customer-confirmed facts.",
      ],
      [
        "این برداشت بر چه منبع و فرض‌هایی استوار است و چه چیزی می‌تواند آن را رد کند؟",
        "Auf welcher Quelle und welchen Annahmen beruht die Sichtweise und was könnte sie widerlegen?",
        "Which source and assumptions support this perspective, and what could disprove it?",
      ],
    ),
    criterion(
      "stakeholder-relevance",
      ["ارتباط با افراد", "Relevanz für Beteiligte", "Stakeholder relevance"],
      [
        "ارتباط فرضیه با مسئولیت افراد باید روشن باشد.",
        "Der Bezug der Hypothese zu den Aufgaben Beteiligter muss klar sein.",
        "Clarify how the hypothesis relates to people's responsibilities.",
      ],
      [
        "این برداشت برای کدام مسئولیت مشتری مرتبط است و چرا؟",
        "Für welche Aufgabe beim Kunden ist diese Sichtweise relevant und warum?",
        "Which customer responsibility does this perspective relate to, and why?",
      ],
    ),
    criterion(
      "customer-response",
      ["پاسخ مشتری", "Kundenreaktion", "Customer response"],
      [
        "تأیید، مخالفت و نبود پاسخ را یکسان تفسیر نکنید.",
        "Unterscheiden Sie Zustimmung, Widerspruch und fehlende Rückmeldung.",
        "Distinguish agreement, disagreement and no response.",
      ],
      [
        "مشتری چه پاسخی داده و کدام بخش فرضیه نیاز به بازنگری دارد؟",
        "Wie hat der Kunde reagiert und welcher Teil der Hypothese braucht Überprüfung?",
        "How has the customer responded, and which part of the hypothesis needs revision?",
      ],
    ),
    criterion(
      "shared-next-step",
      ["گام بعدی مشترک", "Gemeinsamer nächster Schritt", "Shared next step"],
      [
        "تمایل فروشنده را با توافق دوطرفه اشتباه نگیرید.",
        "Setzen Sie Ihren Wunsch nicht mit einer gemeinsamen Vereinbarung gleich.",
        "A seller's preference is not a mutual agreement.",
      ],
      [
        "چه گام بعدی برای هر دو طرف روشن است و کدام تأیید هنوز لازم است؟",
        "Welcher nächste Schritt ist für beide Seiten klar und welche Bestätigung fehlt?",
        "Which next step is understood by both sides, and what confirmation is still needed?",
      ],
    ),
  ],
);
