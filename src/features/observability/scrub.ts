const REDACTED = "[redacted]";
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PUBLICATION_PATH =
  /(?:\/|%2f|%252f)published(?:\/|%2f|%252f)project(?:\/|%2f|%252f)[a-f0-9-]{36}/iu;
const BOOKING_CALENDAR_PATH =
  /(?:\/|%2f|%252f)api(?:\/|%2f|%252f)assets(?:\/|%2f|%252f)bookings(?:\/|%2f|%252f)/iu;
const BOOKING_FEED_SECRET = /wd_booking_/iu;
const PHYSICAL_LABEL_LINK = /(?:\/|%2f|%252f)operations(?:\/|%2f|%252f)scan(?:\?|%3f|%253f)/iu;
const PHYSICAL_LABEL_CODE = /wd-label(?::|%3a|%253a)v1(?::|%3a|%253a)/iu;
const EQUIPMENT_TAG_LINK = /(?:\/|%2f|%252f)equipment-tag(?:\/|%2f|%252f)[A-Za-z0-9_-]{22}/iu;
const EQUIPMENT_TAG_CODE = /wd-tag(?::|%3a|%253a)v1(?::|%3a|%253a)/iu;

export function containsPhysicalLabelLink(value: string): boolean {
  return (
    PHYSICAL_LABEL_LINK.test(value) ||
    PHYSICAL_LABEL_CODE.test(value) ||
    EQUIPMENT_TAG_LINK.test(value) ||
    EQUIPMENT_TAG_CODE.test(value)
  );
}

export function containsPrivateBookingCalendar(value: string): boolean {
  return BOOKING_CALENDAR_PATH.test(value) || BOOKING_FEED_SECRET.test(value);
}

// Keys whose VALUES may carry third-party contact PII. Redacted unless explicitly safe.
const PII_KEY_RE = /email|name|subject|body|content|phone|address/i;
// Custom-event keys we control and know are shape-only, never raw record data.
const SAFE_KEYS = new Set([
  "release",
  "commit",
  "route",
  "errorId",
  "action",
  "surface",
  "level",
  "message",
  "modalId",
  "reason",
  "stageFrom",
  "stageTo",
  "cancelled",
  "kind",
  "path",
  "digest",
]);

function redactEmails(value: string): string {
  return value.replace(EMAIL_RE, "[email]");
}

export function containsProjectPublicationLink(value: string): boolean {
  return PUBLICATION_PATH.test(value);
}

function containsPrivateLink(value: string) {
  return (
    containsProjectPublicationLink(value) ||
    containsPrivateBookingCalendar(value) ||
    containsPhysicalLabelLink(value)
  );
}

function scrubUrlFields(props: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(props).map(([key, value]) => [
      key,
      typeof value === "string" && containsPrivateLink(value) ? REDACTED : value,
    ]),
  );
}

// PostHog builds its exception payload ($exception_list: message + stack) directly from the raw
// error, which bypasses the property scrub in scrubProperties. Hand captureException an error whose
// message and stack already have emails redacted so a customer address in an error string cannot
// leak into a replay or exception event. Only emails are stripped, matching the project's "internal
// CRM, unmask except email content" stance. Non-error, non-string inputs pass through by reference.
export function sanitizeErrorEmails(error: unknown): unknown {
  if (error instanceof Error) {
    const sanitized = new Error(
      containsPrivateLink(error.message) ? REDACTED : redactEmails(error.message),
    );
    sanitized.name = error.name;
    if (typeof error.stack === "string")
      sanitized.stack = containsPrivateLink(error.stack) ? REDACTED : redactEmails(error.stack);
    return sanitized;
  }
  if (typeof error === "string") return containsPrivateLink(error) ? REDACTED : redactEmails(error);
  return error;
}

export function scrubProperties(props: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(scrubUrlFields(props))) {
    if (
      (key === "$set" || key === "$set_once") &&
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      out[key] = scrubUrlFields(value as Record<string, unknown>);
      continue;
    }
    if (key === "message" && typeof value === "string") {
      out[key] = redactEmails(value);
      continue;
    }
    if (key.startsWith("$") || SAFE_KEYS.has(key)) {
      out[key] = value;
      continue;
    }
    out[key] = PII_KEY_RE.test(key) ? REDACTED : value;
  }
  return out;
}

export function scrubEvent<T extends { properties?: Record<string, unknown> } | null>(event: T): T {
  if (event === null) return event;
  if (event.properties !== undefined) event.properties = scrubProperties(event.properties);
  return event;
}
