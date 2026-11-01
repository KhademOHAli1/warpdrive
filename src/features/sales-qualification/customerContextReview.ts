import { criterion, originalDefinition } from "./catalogAuthoring";

export const customerContextReview = originalDefinition(
  "customer-context-review",
  ["بررسی زمینهٔ مشتری", "Kundenkontext prüfen", "Customer context review"],
  [
    "شرایط مشتری و نیازهای تصمیم را با توجه به پیامدها و رویدادهای بیرونی بررسی کنید.",
    "Prüfen Sie Kundenlage und Entscheidungsbedarf mit Folgen und äußeren Terminen.",
    "Review customer circumstances and decision needs alongside consequences and external milestones.",
  ],
  "SPICED",
  "https://winningbydesign.com/spiced-framework/",
  [
    criterion(
      "operating-context",
      ["شرایط کار", "Arbeitskontext", "Operating context"],
      [
        "محیط کار و محدودیت‌های مرتبط را به زبان مشتری روشن کنید.",
        "Klären Sie Arbeitsumfeld und relevante Grenzen aus Kundensicht.",
        "Clarify the working environment and constraints in the customer's terms.",
      ],
      [
        "کدام شرایط فعلی برای درک نیاز مشتری ضروری است؟",
        "Welche heutigen Umstände sind für den Bedarf entscheidend?",
        "Which current circumstances are essential to understanding the customer's need?",
      ],
    ),
    criterion(
      "reported-difficulty",
      ["دشواری بیان‌شده", "Benannte Schwierigkeit", "Reported difficulty"],
      [
        "گزارش مشتری را از تفسیر و حدس جدا نگه دارید.",
        "Halten Sie Kundenbericht, Deutung und Vermutung auseinander.",
        "Keep the customer report separate from interpretation and guesses.",
      ],
      [
        "مشتری کدام دشواری را بیان کرده و منبع گزارش چیست؟",
        "Welche Schwierigkeit nennt der Kunde und wo ist sie belegt?",
        "Which difficulty has the customer reported, and where is that report supported?",
      ],
    ),
    criterion(
      "outcome-consequences",
      ["نتیجه و پیامد", "Ergebnis und Folgen", "Outcomes and consequences"],
      [
        "نتیجهٔ موردانتظار را از نتیجهٔ مشاهده‌شده جدا کنید.",
        "Trennen Sie erwartete Ergebnisse von beobachteten Ergebnissen.",
        "Distinguish expected outcomes from observed outcomes.",
      ],
      [
        "چه پیامدی مشاهده شده و کدام نتیجه هنوز یک انتظار است؟",
        "Welche Folge wurde beobachtet und welches Ergebnis wird erst erwartet?",
        "Which consequence has been observed, and which outcome is still an expectation?",
      ],
    ),
    criterion(
      "external-milestone",
      ["رویداد بیرونی", "Äußerer Meilenstein", "External milestone"],
      [
        "رویداد و پیامد تأخیر را مستقل از هدف پایان فروش بررسی کنید.",
        "Prüfen Sie Termin und Verzögerungsfolge unabhängig vom Vertriebsziel.",
        "Review the milestone and delay consequences independently of the seller's target close date.",
      ],
      [
        "کدام رویداد برای مشتری مهم است و تأخیر چه پیامدی دارد؟",
        "Welches Ereignis zählt für den Kunden und was folgt aus einer Verzögerung?",
        "Which event matters to the customer, and what would a delay change?",
      ],
    ),
    criterion(
      "decision-requirements",
      ["نیازهای تصمیم", "Entscheidungsanforderungen", "Decision requirements"],
      [
        "افراد، اطلاعات و گام‌های لازم برای انتخاب را روشن کنید.",
        "Klären Sie Beteiligte, Informationen und Schritte für eine Auswahl.",
        "Clarify the people, information and steps needed to choose.",
      ],
      [
        "چه کسانی به چه اطلاعاتی برای تصمیم نیاز دارند و چه چیزی باز است؟",
        "Wer benötigt welche Informationen für die Entscheidung und was fehlt?",
        "Who needs which information to decide, and what remains open?",
      ],
    ),
  ],
);
