import type { Locale } from "@/features/i18n/registry";
import type { BookingAutomationTrigger } from "./contracts";

export const bookingAutomationTriggerLabels = {
  en: {
    request_sent_back: "Changes requested",
    return_overdue: "Return overdue",
    pickup_expired: "Pickup missed",
  },
  de: {
    request_sent_back: "Änderungen angefordert",
    return_overdue: "Rückgabe überfällig",
    pickup_expired: "Abholung verpasst",
  },
  fa: {
    request_sent_back: "درخواست تغییر",
    return_overdue: "بازگشت معوق",
    pickup_expired: "زمان تحویل از دست رفت",
  },
} satisfies Record<Locale, Record<BookingAutomationTrigger, string>>;
