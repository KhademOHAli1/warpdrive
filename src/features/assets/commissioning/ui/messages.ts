import type { Locale } from "@/features/i18n/registry";

const en = {
  action: "Commission as equipment",
  title: "Commission stock as equipment",
  description:
    "Deduct one unit from Inventory and register the same serial number as equipment at this site and location.",
  part: "Part",
  revision: "Revision",
  serial: "Serial number",
  lot: "Lot",
  site: "Site",
  location: "Location",
  code: "Equipment code",
  name: "Equipment name",
  reason: "Handoff reason",
  created: "Equipment created and Inventory updated.",
  openAsset: "Open equipment record",
  invalid: "Review the equipment details and handoff reason.",
  unavailable: "This stock position is unavailable to your account.",
  ineligible: "This position has no available serialized unit to commission.",
  stale: "The source stock changed. Refresh the stock position and review it again.",
  conflict: "The equipment code or serial is already registered, or the request is already in use.",
  transport: "Warpdrive could not confirm the handoff. Retry to check the same request.",
};

type CommissionStockMessages = Record<keyof typeof en, string>;

const de: CommissionStockMessages = {
  action: "Als Betriebsmittel übernehmen",
  title: "Lagerartikel als Betriebsmittel übernehmen",
  description:
    "Buchen Sie eine Einheit aus dem Lagerbestand aus und registrieren Sie dieselbe Seriennummer an diesem Standort und Lagerort als Betriebsmittel.",
  part: "Artikel",
  revision: "Revision",
  serial: "Seriennummer",
  lot: "Charge",
  site: "Standort",
  location: "Lagerort",
  code: "Betriebsmittelcode",
  name: "Betriebsmittelname",
  reason: "Grund für die Übernahme",
  created: "Das Betriebsmittel wurde angelegt und der Lagerbestand wurde aktualisiert.",
  openAsset: "Betriebsmittel öffnen",
  invalid: "Prüfen Sie die Daten des Betriebsmittels und den Grund für die Übernahme.",
  unavailable: "Diese Bestandsposition ist für Ihr Konto nicht verfügbar.",
  ineligible:
    "An dieser Position ist keine einzelne Einheit mit Seriennummer zur Übernahme verfügbar.",
  stale:
    "Der Lagerbestand hat sich geändert. Aktualisieren und prüfen Sie die Bestandsposition erneut.",
  conflict: "Der Betriebsmittelcode, die Seriennummer oder die Anfrage wird bereits verwendet.",
  transport:
    "Warpdrive konnte die Übernahme nicht bestätigen. Wiederholen Sie die Anfrage, um ihren Status zu prüfen.",
};

const fa: CommissionStockMessages = {
  action: "ثبت به‌عنوان تجهیز",
  title: "ثبت کالای انبار به‌عنوان تجهیز",
  description:
    "یک واحد از موجودی کسر می‌شود و تجهیز با همان شماره سریال در همین سایت و محل ثبت می‌شود.",
  part: "قطعه",
  revision: "بازنگری",
  serial: "شماره سریال",
  lot: "بچ",
  site: "سایت",
  location: "محل",
  code: "کد تجهیز",
  name: "نام تجهیز",
  reason: "دلیل انتقال",
  created: "تجهیز ثبت و موجودی انبار به‌روز شد.",
  openAsset: "بازکردن پروندهٔ تجهیز",
  invalid: "مشخصات تجهیز و دلیل انتقال را بررسی کنید.",
  unavailable: "این موقعیت موجودی برای حساب شما در دسترس نیست.",
  ineligible: "در این موقعیت واحد دارای شماره سریال برای ثبت به‌عنوان تجهیز در دسترس نیست.",
  stale: "موجودی مبدأ تغییر کرده است. موقعیت موجودی را به‌روز و دوباره بررسی کنید.",
  conflict: "کد تجهیز، شماره سریال یا درخواست قبلاً استفاده شده است.",
  transport: "وارپ‌درایو نتوانست انتقال را تأیید کند. برای بررسی همان درخواست دوباره تلاش کنید.",
};

export const commissionStockMessages = { en, de, fa } satisfies Record<
  Locale,
  CommissionStockMessages
>;
