import { criterion, originalDefinition } from "./catalogAuthoring";

export const complexPurchaseReview = originalDefinition(
  "complex-purchase-review",
  ["بررسی خرید پیچیده", "Komplexen Einkauf prüfen", "Complex purchase review"],
  [
    "شواهد ارزش و مسیرهای ارزیابی، تأیید و قرارداد را جداگانه بررسی کنید.",
    "Prüfen Sie Wertbelege sowie Bewertung, Freigabe und Vertrag getrennt.",
    "Review value evidence, evaluation, approval and contracting as separate questions.",
  ],
  "MEDDPICC",
  "https://meddicc.com/meddpicc-sales-methodology-and-process",
  [
    criterion(
      "value-evidence",
      ["شواهد ارزش", "Wertbelege", "Value evidence"],
      [
        "پیامد قابل‌اندازه‌گیری به منبع، مبنا و فرض نیاز دارد.",
        "Messbarer Nutzen braucht Quelle, Ausgangswert und Annahmen.",
        "Measurable value needs a source, baseline and assumptions.",
      ],
      [
        "کدام نتیجه برای مشتری مهم است و چه داده‌ای مبنای مقایسه است؟",
        "Welches Ergebnis zählt für den Kunden und welche Daten bilden den Vergleich?",
        "Which outcome matters to the customer, and what data provides a comparison?",
      ],
    ),
    criterion(
      "spending-authority",
      ["اختیار هزینه", "Ausgabenbefugnis", "Spending authority"],
      [
        "اختیار نهایی را از حضور در جلسه نتیجه نگیرید.",
        "Leiten Sie letzte Ausgabenbefugnis nicht aus einer Teilnahme ab.",
        "Meeting attendance does not establish final spending authority.",
      ],
      [
        "چه کسی اختیار هزینه را دارد و چه مدرکی این موضوع را روشن می‌کند؟",
        "Wer hat die Ausgabenbefugnis und was belegt sie?",
        "Who holds spending authority, and what establishes that role?",
      ],
    ),
    criterion(
      "evaluation-requirements",
      ["نیازهای ارزیابی", "Bewertungsanforderungen", "Evaluation requirements"],
      [
        "معیارهای اعلام‌شده و موارد تأییدنشده را جدا کنید.",
        "Trennen Sie erklärte Anforderungen von unbestätigten Annahmen.",
        "Separate stated requirements from unconfirmed assumptions.",
      ],
      [
        "مشتری بر چه اساسی گزینه‌ها را مقایسه می‌کند و چه چیزی هنوز روشن نیست؟",
        "Woran vergleicht der Kunde Optionen und was bleibt unklar?",
        "How will the customer compare options, and what is still unclear?",
      ],
    ),
    criterion(
      "approval-path",
      ["مسیر تأیید", "Freigabeweg", "Approval path"],
      [
        "گام‌ها، مسئولیت‌ها و وابستگی‌های تصمیم را بررسی کنید.",
        "Prüfen Sie Entscheidungsschritte, Zuständigkeiten und Abhängigkeiten.",
        "Review decision steps, responsibilities and dependencies.",
      ],
      [
        "چه تأییدهایی لازم است و مشتری کدام گام‌ها را تأیید کرده است؟",
        "Welche Freigaben sind nötig und welche Schritte hat der Kunde bestätigt?",
        "Which approvals are needed, and which steps has the customer confirmed?",
      ],
    ),
    criterion(
      "contracting-path",
      ["مسیر قرارداد", "Vertragsweg", "Contracting path"],
      [
        "نیازهای خرید و قرارداد را با تصمیم تجاری یکی نگیرید.",
        "Setzen Sie Beschaffung und Vertrag nicht mit der Kaufentscheidung gleich.",
        "Keep procurement and contracting separate from the commercial decision.",
      ],
      [
        "پس از انتخاب، چه بررسی‌های خرید یا قراردادی باقی می‌ماند؟",
        "Welche Beschaffungs- oder Vertragsprüfungen folgen auf die Auswahl?",
        "Which procurement or contract reviews remain after selection?",
      ],
    ),
    criterion(
      "problem-consequences",
      ["پیامدهای مشکل", "Folgen des Problems", "Problem consequences"],
      [
        "پیامد تأییدشده را از پیش‌بینی فروشنده جدا کنید.",
        "Trennen Sie bestätigte Folgen von Ihrer Prognose.",
        "Distinguish confirmed consequences from seller forecasts.",
      ],
      [
        "مشتری چه پیامدی را توصیف کرده و کدام بخش صرفاً فرض است؟",
        "Welche Folgen beschreibt der Kunde und was ist bisher nur eine Annahme?",
        "Which consequences has the customer described, and which remain assumptions?",
      ],
    ),
    criterion(
      "internal-support",
      ["حمایت داخلی", "Interne Unterstützung", "Internal support"],
      [
        "وجود یک مخاطب به معنی حمایت مؤثر او نیست.",
        "Ein Kontakt belegt noch keine wirksame interne Unterstützung.",
        "A named contact alone does not establish active internal support.",
      ],
      [
        "چه اقدام مشاهده‌شده‌ای حمایت داخلی را نشان می‌دهد و چه چیزی نامشخص است؟",
        "Welche beobachtete Handlung belegt Unterstützung und was bleibt offen?",
        "What observed action supports internal advocacy, and what is unknown?",
      ],
    ),
    criterion(
      "alternatives",
      ["گزینه‌های جایگزین", "Alternativen", "Alternatives"],
      [
        "راهکار فعلی و تعویق تصمیم نیز می‌توانند گزینه باشند.",
        "Auch der Istzustand und ein Aufschub können Optionen sein.",
        "The current approach and a delayed decision may also be alternatives.",
      ],
      [
        "مشتری چه گزینه‌هایی را واقعاً بررسی می‌کند و منبع این اطلاع چیست؟",
        "Welche Alternativen prüft der Kunde tatsächlich und woher wissen Sie das?",
        "Which alternatives is the customer considering, and what is the source?",
      ],
    ),
  ],
);
