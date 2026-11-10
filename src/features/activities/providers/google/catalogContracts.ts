import type { CalendarAuthorizationError } from "./authorizationConfig";
import type { GoogleCalendarError } from "./contracts";

export type CalendarCatalogError =
  | CalendarAuthorizationError
  | GoogleCalendarError
  | { kind: "storage" };

export interface GoogleCalendarSelection {
  bindingId: string;
  localCalendarId: string;
  version: number;
  selected: boolean;
}

export interface GoogleCalendarCatalogEntry {
  id: string;
  calendarId: string;
  name: string;
  timeZone: string | null;
  accessRole: string | null;
  hidden: boolean;
  deleted: boolean;
  available: boolean;
  supportsMeet: boolean;
  selection?: GoogleCalendarSelection;
}

export interface GoogleCalendarCatalog {
  accountId: string;
  revision: number;
  status: "empty" | "ready" | "refreshing" | "error" | "unavailable";
  calendars: GoogleCalendarCatalogEntry[];
  discoveredAt: string | null;
}
