import { criterion, originalDefinition } from "./catalogAuthoring";

export const discoveryConversation = originalDefinition(
  "discovery-conversation",
  ["گفت‌وگوی شناخت نیاز", "Gespräch zum Bedarf", "Discovery conversation"],
  [
    "زمینه، دشواری و فایدهٔ موردنظر مشتری را بررسی کنید؛ ترتیب اجباری برای گفت‌وگو وجود ندارد.",
    "Erkunden Sie Kontext, Schwierigkeiten und gewünschten Nutzen ohne feste Gesprächsfolge.",
    "Explore context, difficulties and desired customer benefit without a required conversation sequence.",
  ],
  "SPIN",
  "https://www.huthwaiteinternational.com/spin-methodology",
  [
    criterion(
      "current-work",
      ["روش کار فعلی", "Heutige Arbeitsweise", "Current work"],
      [
        "اطلاعات مرتبط با کار فعلی را با منبع روشن نگه دارید.",
        "Halten Sie relevante Fakten zur heutigen Arbeit mit Quelle fest.",
        "Keep relevant facts about current work tied to a source.",
      ],
      [
        "برای فهم روش کار امروز مشتری چه واقعیت‌هایی لازم است؟",
        "Welche Fakten brauchen Sie, um die heutige Arbeit zu verstehen?",
        "Which facts are needed to understand how the customer works today?",
      ],
    ),
    criterion(
      "work-friction",
      ["دشواری در کار", "Hindernisse im Alltag", "Work friction"],
      [
        "وجود مشکل را از قبل فرض نکنید؛ گفتهٔ مشتری مبناست.",
        "Setzen Sie kein Problem voraus; die Kundenaussage ist maßgeblich.",
        "Do not presume a problem; start with what the customer says.",
      ],
      [
        "مشتری کجا دشواری می‌بیند و کجا روش فعلی مناسب است؟",
        "Wo sieht der Kunde Schwierigkeiten und wo funktioniert die heutige Arbeit?",
        "Where does the customer see difficulty, and where does the current approach work well?",
      ],
    ),
    criterion(
      "downstream-effects",
      ["آثار بعدی", "Weitere Auswirkungen", "Downstream effects"],
      [
        "پیوند میان مشکل و اثر بعدی به پشتوانه نیاز دارد.",
        "Der Zusammenhang zwischen Schwierigkeit und Folge braucht Belege.",
        "The connection between a difficulty and later effects needs support.",
      ],
      [
        "چه اثری بر کارهای دیگر گزارش شده و کدام پیوند هنوز فرض است؟",
        "Welche Folgen für andere Arbeit wurden berichtet und welcher Zusammenhang ist offen?",
        "What effects on other work have been reported, and which connections remain assumptions?",
      ],
    ),
    criterion(
      "customer-described-benefit",
      ["فایده از دید مشتری", "Nutzen aus Kundensicht", "Customer-described benefit"],
      [
        "فایدهٔ موردنظر مشتری را به ادعای تضمین نتیجه تبدیل نکنید.",
        "Machen Sie aus gewünschtem Nutzen keine Ergebnisgarantie.",
        "A benefit the customer wants is not a guaranteed outcome.",
      ],
      [
        "از دید مشتری چه تغییری مفید است و چرا؟",
        "Welche Veränderung wäre aus Kundensicht hilfreich und warum?",
        "Which change would the customer find useful, and why?",
      ],
    ),
  ],
);
