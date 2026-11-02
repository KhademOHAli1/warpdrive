export const deliveryUiIds = {
  report: "601e4ee6-caa2-4cd4-81ae-d7ce96f53e01",
  source: "601e4ee6-caa2-4cd4-81ae-d7ce96f53e02",
  attempt: "601e4ee6-caa2-4cd4-81ae-d7ce96f53e03",
  secondAttempt: "601e4ee6-caa2-4cd4-81ae-d7ce96f53e04",
};

export const deliveryUiRecipient = {
  index: 0,
  finalRecipient: { type: "rfc822", value: "Kunde@example.test" },
  originalRecipient: null,
  remoteMta: null,
  action: "failed" as const,
  status: "5.1.1",
  statusClass: 5 as const,
  terminalReport: true,
  actionStatus: "consistent" as const,
  diagnostic: {
    type: "smtp",
    text: "550 نشانی پیدا نشد / Adresse nicht gefunden",
    display: "plain_text" as const,
  },
  localizedDiagnostics: [
    { languageTag: "fa", text: "نشانی گیرنده پیدا نشد", display: "plain_text" as const },
    {
      languageTag: "de",
      text: "Die Empfängeradresse wurde nicht gefunden",
      display: "plain_text" as const,
    },
  ],
  lastAttemptDate: null,
  finalLogId: null,
  willRetryUntil: null,
  extensions: [],
  review: { revision: 0, decision: "unreviewed" as const, target: null },
};

export const deliveryUiReport = {
  id: deliveryUiIds.report,
  sourceMessageId: deliveryUiIds.source,
  partKey: "2",
  mediaType: "message/global-delivery-status" as const,
  provenance: "direct" as const,
  trust: "unverified" as const,
  requiresReview: true as const,
  recipients: [deliveryUiRecipient],
};

export const deliveryUiPrimaryTarget = {
  attemptId: deliveryUiIds.attempt,
  subject: "پیشنهاد همکاری / Angebot zur Zusammenarbeit",
  sentAt: "2026-10-31T10:00:00.000Z",
  recipients: [
    { address: "Kunde@example.test", kind: "to" as const },
    { address: "private-bcc@example.test", kind: "bcc" as const },
  ],
};

export const deliveryUiSecondTarget = {
  attemptId: deliveryUiIds.secondAttempt,
  subject: "پیگیری پیشنهاد / Rückfrage zum Angebot",
  sentAt: "2026-10-31T11:00:00.000Z",
  recipients: [{ address: "Kunde@example.test", kind: "to" as const }],
};

export const deliveryUiTargets = [deliveryUiPrimaryTarget, deliveryUiSecondTarget];

export const deliveryUiLabels = {
  en: {
    title: "Delivery reports",
    warning: "This report is unverified. Review it before linking it to a sent email.",
    review: "Review report",
    sentEmail: "Sent email",
    recipient: "Recipient",
    cancel: "Cancel",
    noTargets:
      "There are no eligible sent emails to associate with this report. You can still dismiss it.",
    targetDetails: "Selected email details",
    reference: "Email reference",
    chooseSentEmail: "Choose a sent email",
    chooseRecipient: "Choose a recipient",
    confirmation: "I reviewed this unverified report",
    save: "Save association",
    dismiss: "Dismiss report",
    saved: "Review saved",
    failure: "Your review could not be saved. Try again.",
    permission: "Your access has changed. Refresh this message before reviewing again.",
    conflict: "This report has changed. Refresh it before reviewing again.",
    reportedFailure: "Reported delivery failure",
  },
  fa: {
    title: "گزارش‌های تحویل",
    warning:
      "اصالت این گزارش تأیید نشده است. پیش از پیوند دادن آن به ایمیل ارسالی، آن را بررسی کنید.",
    review: "بررسی گزارش",
    sentEmail: "ایمیل ارسالی",
    recipient: "گیرنده",
    cancel: "انصراف",
    noTargets:
      "ایمیل ارسالی مناسبی برای پیوند دادن به این گزارش در دسترس نیست. همچنان می‌توانید گزارش را کنار بگذارید.",
    targetDetails: "جزئیات ایمیل انتخاب‌شده",
    reference: "شناسه ایمیل",
    chooseSentEmail: "ایمیل ارسالی را انتخاب کنید",
    chooseRecipient: "گیرنده را انتخاب کنید",
    confirmation: "این گزارش تأییدنشده را بررسی کردم",
    save: "ذخیره پیوند",
    dismiss: "کنار گذاشتن گزارش",
    saved: "نتیجه بررسی ذخیره شد",
    failure: "نتیجه بررسی ذخیره نشد. دوباره تلاش کنید.",
    permission: "دسترسی شما تغییر کرده است. پیش از بررسی دوباره، این پیام را تازه‌سازی کنید.",
    conflict: "این گزارش تغییر کرده است. پیش از بررسی دوباره، آن را تازه‌سازی کنید.",
    reportedFailure: "گزارش عدم تحویل",
  },
  de: {
    title: "Zustellberichte",
    warning:
      "Die Echtheit dieses Berichts ist nicht bestätigt. Prüfen Sie ihn, bevor Sie ihn einer gesendeten E-Mail zuordnen.",
    review: "Bericht prüfen",
    sentEmail: "Gesendete E-Mail",
    recipient: "Empfänger",
    cancel: "Abbrechen",
    noTargets:
      "Es sind keine geeigneten gesendeten E-Mails für eine Zuordnung verfügbar. Sie können den Bericht weiterhin verwerfen.",
    targetDetails: "Details der ausgewählten E-Mail",
    reference: "E-Mail-Referenz",
    chooseSentEmail: "Gesendete E-Mail auswählen",
    chooseRecipient: "Empfänger auswählen",
    confirmation: "Ich habe diesen unbestätigten Bericht geprüft",
    save: "Zuordnung speichern",
    dismiss: "Bericht verwerfen",
    saved: "Prüfung gespeichert",
    failure: "Ihre Prüfung konnte nicht gespeichert werden. Versuchen Sie es erneut.",
    permission:
      "Ihre Zugriffsrechte haben sich geändert. Laden Sie diese Nachricht vor einer erneuten Prüfung neu.",
    conflict: "Dieser Bericht wurde geändert. Laden Sie ihn vor einer erneuten Prüfung neu.",
    reportedFailure: "Gemeldete Nichtzustellung",
  },
};
