import { criterion, originalDefinition } from "./catalogAuthoring";

export const mutualWorkingAgreement = originalDefinition(
  "mutual-working-agreement",
  ["توافق کاری دوطرفه", "Gemeinsame Arbeitsvereinbarung", "Mutual working agreement"],
  [
    "هدف، محدودیت‌ها و انتظارهای دو طرف را بدون تعهد خودکار تجاری روشن کنید.",
    "Klären Sie Ziel, Grenzen und gegenseitige Erwartungen ohne automatische Geschäftsverpflichtung.",
    "Clarify purpose, limits and mutual expectations without creating a commercial commitment.",
  ],
  "Sandler",
  "https://sandler.com/sandler-selling-system/",
  [
    criterion(
      "meeting-purpose",
      ["هدف جلسه", "Gesprächsziel", "Meeting purpose"],
      [
        "هدف و حدود گفت‌وگو باید برای دو طرف روشن باشد.",
        "Ziel und Grenzen des Gesprächs sollen beiden Seiten klar sein.",
        "Both sides should understand the purpose and limits of the conversation.",
      ],
      [
        "دو طرف چه هدفی برای این گفت‌وگو دارند و چه چیزی خارج از آن است؟",
        "Welches Ziel haben beide Seiten und was gehört nicht zu diesem Gespräch?",
        "What purpose do both sides have for this conversation, and what is outside it?",
      ],
    ),
    criterion(
      "customer-concern",
      ["موضوع مشتری", "Anliegen des Kunden", "Customer concern"],
      [
        "نگرانی مشتری و موارد نامشخص را به زبان خودش نگه دارید.",
        "Halten Sie Kundenanliegen und offene Punkte in dessen Worten fest.",
        "Keep the customer's concern and uncertainties in their own terms.",
      ],
      [
        "مشتری چه موضوعی را می‌خواهد بررسی کند و چه چیزی هنوز روشن نیست؟",
        "Welches Anliegen möchte der Kunde prüfen und was ist noch unklar?",
        "What concern does the customer want to explore, and what is still unclear?",
      ],
    ),
    criterion(
      "resource-limits",
      ["محدودیت منابع", "Grenzen der Mittel", "Resource limits"],
      [
        "زمان، ظرفیت و هزینه را بدون فرض وجود بودجه بررسی کنید.",
        "Prüfen Sie Zeit, Kapazität und Kosten ohne ein Budget vorauszusetzen.",
        "Review time, capacity and cost without assuming a budget exists.",
      ],
      [
        "چه محدودیت‌هایی بر امکان ادامهٔ بررسی اثر دارد؟",
        "Welche Grenzen beeinflussen eine weitere Prüfung?",
        "Which constraints affect whether further review is practical?",
      ],
    ),
    criterion(
      "decision-participation",
      ["مشارکت در تصمیم", "Beteiligung an der Entscheidung", "Decision participation"],
      [
        "افراد و گام‌های تصمیم را از تعهد به خرید جدا کنید.",
        "Trennen Sie Beteiligte und Entscheidungsschritte von einer Kaufzusage.",
        "People and decision steps do not establish a commitment to buy.",
      ],
      [
        "چه کسانی و چه گام‌هایی برای یک تصمیم معتبر لازم‌اند؟",
        "Welche Beteiligten und Schritte braucht eine gültige Entscheidung?",
        "Which participants and steps are needed for a valid decision?",
      ],
    ),
    criterion(
      "agreed-next-action",
      ["اقدام بعدی توافق‌شده", "Vereinbarte nächste Handlung", "Agreed next action"],
      [
        "پیشنهاد اقدام را از پذیرش آن توسط طرف مقابل جدا کنید.",
        "Trennen Sie einen Handlungsvorschlag von dessen Annahme.",
        "Separate a proposed action from the other side's acceptance.",
      ],
      [
        "چه اقدامی با چه مسئولیتی توافق شده و چه چیزی هنوز پیشنهاد است؟",
        "Welche Handlung mit welcher Zuständigkeit ist vereinbart und was ist nur vorgeschlagen?",
        "Which action and responsibility are agreed, and what is still only proposed?",
      ],
    ),
    criterion(
      "post-decision-expectations",
      ["انتظارهای پس از تصمیم", "Erwartungen nach der Entscheidung", "Post-decision expectations"],
      [
        "انتظارهای بعدی را بدون ساخت قرارداد یا تعهد تازه روشن کنید.",
        "Klären Sie spätere Erwartungen ohne neue Vertragsbindung zu erzeugen.",
        "Clarify later expectations without creating a contract or new obligation.",
      ],
      [
        "پس از هر نتیجهٔ ممکن، دو طرف چه انتظاری از ادامه یا پایان کار دارند؟",
        "Was erwarten beide Seiten nach jedem möglichen Ergebnis zur Fortsetzung oder zum Abschluss?",
        "After each possible outcome, what do both sides expect about continuing or closing the work?",
      ],
    ),
  ],
);
