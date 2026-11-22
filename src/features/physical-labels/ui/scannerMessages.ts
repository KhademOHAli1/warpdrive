import type { Locale } from "@/features/i18n/registry";

const en = {
  title: "Scan a label",
  instructions: "Use your camera, a connected scanner, or enter a code.",
  registry: "Label registry",
  demo: "Demo data",
  code: "Label code",
  lookup: "Look up label",
  cameraOn: "Start camera",
  cameraOff: "Stop camera",
  preview: "Camera preview",
  cameraError:
    "The camera could not start. You can still enter the code or use a connected scanner.",
  cameraTimeout: "The camera stopped after two minutes. Start it again to scan another label.",
  invalid: "Check the code and try again.",
  unavailable: "This label is unavailable.",
  transport: "The lookup could not be completed. Try again.",
  open: "Open record",
};

export const scannerMessages: Record<Locale, typeof en> = {
  en,
  de: {
    title: "Etikett scannen",
    instructions:
      "Verwenden Sie Ihre Kamera oder einen angeschlossenen Scanner oder geben Sie den Code ein.",
    registry: "Etikettenregister",
    demo: "Demodaten",
    code: "Etikettencode",
    lookup: "Etikett suchen",
    cameraOn: "Kamera starten",
    cameraOff: "Kamera stoppen",
    preview: "Kameravorschau",
    cameraError:
      "Die Kamera konnte nicht gestartet werden. Geben Sie den Code ein oder verwenden Sie einen angeschlossenen Scanner.",
    cameraTimeout:
      "Die Kamera wurde nach zwei Minuten gestoppt. Starten Sie sie erneut, um ein weiteres Etikett zu scannen.",
    invalid: "Überprüfen Sie den Code und versuchen Sie es erneut.",
    unavailable: "Dieses Etikett ist nicht verfügbar.",
    transport: "Die Suche konnte nicht abgeschlossen werden. Versuchen Sie es erneut.",
    open: "Datensatz öffnen",
  },
  fa: {
    title: "اسکن برچسب",
    instructions: "از دوربین یا اسکنر متصل استفاده کنید، یا کد را وارد کنید.",
    registry: "فهرست برچسب‌ها",
    demo: "داده‌های نمونه",
    code: "کد برچسب",
    lookup: "جستجوی برچسب",
    cameraOn: "روشن کردن دوربین",
    cameraOff: "خاموش کردن دوربین",
    preview: "پیش‌نمایش دوربین",
    cameraError: "دوربین روشن نشد. می‌توانید کد را وارد کنید یا از اسکنر متصل استفاده کنید.",
    cameraTimeout: "دوربین پس از دو دقیقه خاموش شد. برای اسکن دوباره آن را روشن کنید.",
    invalid: "کد را بررسی کنید و دوباره تلاش کنید.",
    unavailable: "این برچسب در دسترس نیست.",
    transport: "جستجو انجام نشد. دوباره تلاش کنید.",
    open: "باز کردن رکورد",
  },
};
