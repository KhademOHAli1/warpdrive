import type { LocalePreferences } from "@/features/i18n/preferences";
import { localeWithNumberingSystem } from "@/lib/numberingSystem";
import type { authScreensMessagesForLocale } from "../authScreensMessages";

export type AuthFlowMessages = ReturnType<typeof authScreensMessagesForLocale>["flow"];
export type VerificationNextStep = "check_new_email" | "sign_in" | "continue";

export function verificationNextStep(data: unknown): VerificationNextStep | null {
  if (typeof data !== "object" || data === null || !("status" in data) || data.status !== true)
    return null;
  if (!("user" in data)) return "check_new_email";
  if (data.user === null) return "sign_in";
  return typeof data.user === "object" &&
    "emailVerified" in data.user &&
    data.user.emailVerified === true
    ? "continue"
    : null;
}

export function normalizeAuthCode(value: string): string {
  return value.trim().replace(/[۰-۹٠-٩]/g, (digit) => {
    const code = digit.charCodeAt(0);
    return String(code >= 0x6f0 ? code - 0x6f0 : code - 0x660);
  });
}

export function safeAuthDestination(value: string | null | undefined): string {
  if (
    value === null ||
    value === undefined ||
    value.length === 0 ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    value.length > 4096 ||
    Array.from(value).some((character) => character.charCodeAt(0) < 32)
  )
    return "/pipeline";
  const path = new URL(value, "https://warpdrive.invalid");
  if (path.pathname === "/login" || path.pathname.startsWith("/auth/")) return "/pipeline";
  return `${path.pathname}${path.search}`;
}

function errorCode(error: unknown): string {
  if (typeof error === "string") return error;
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  )
    return error.code;
  return "";
}

export function authErrorMessage(error: unknown, L: AuthFlowMessages): string {
  const code = errorCode(error);
  if (code === "VERIFICATION_ACCOUNT_MISMATCH") return L.verificationAccountMismatch;
  if (/INVALID_VERIFICATION_TOKEN/.test(code)) return L.invalidVerification;
  if (/PASSWORD_TOO_SHORT|PASSWORD_TOO_LONG|PASSWORD_LENGTH/.test(code)) return L.passwordPolicy;
  if (/RATE_LIMIT|TOO_MANY|LOCKED/.test(code)) return L.rateLimited;
  if (/FRESH|REAUTH/.test(code)) return L.freshRequired;
  if (/INVIT/.test(code)) return L.invalidInvitation;
  if (/INVALID_EMAIL_OR_PASSWORD|INVALID_PASSWORD|INVALID_CREDENTIALS/.test(code))
    return L.invalidCredentials;
  if (/INVALID_CODE|INVALID_BACKUP|OTP.*EXPIRED|INVALID_TWO_FACTOR/.test(code))
    return L.invalidCode;
  if (/EMAIL_NOT_VERIFIED/.test(code)) return L.verifyEmailRequired;
  if (/LAST.*METHOD|CANNOT_UNLINK_LAST/.test(code)) return L.lastMethod;
  if (/ACCOUNT.*LINK|ACCOUNT.*EXIST|EMAIL_ALREADY/.test(code)) return L.providerConflict;
  if (/UNAUTHORIZED|SESSION.*EXPIRED|NOT_AUTHENTICATED/.test(code)) return L.sessionExpired;
  if (/FORBIDDEN|PERMISSION|MFA_REQUIRED/.test(code)) return L.forbidden;
  if (/PROVIDER.*DISABLED|PROVIDER_NOT_FOUND/.test(code)) return L.providerUnavailable;
  if (/PASSKEY|AUTH_CANCELLED|REGISTRATION_CANCELLED|AUTHENTICATOR_NOT_FOUND|CEREMONY/.test(code))
    return L.passkeyCancelled;
  return L.genericError;
}

export function formatAuthDate(value: string, preferences: LocalePreferences): string {
  return new Intl.DateTimeFormat(
    localeWithNumberingSystem(preferences.locale, preferences.numberingSystem),
    {
      calendar: preferences.calendar,
      timeZone: preferences.timeZone,
      dateStyle: "medium",
      timeStyle: "short",
    },
  ).format(new Date(value));
}

export function authEventLabel(action: string, L: AuthFlowMessages): string {
  const categories: [RegExp, string][] = [
    [/sign.?out|logout/i, L.eventSignOut],
    [/sign.?in|login|callback/i, L.eventSignIn],
    [/passkey/i, L.eventPasskey],
    [/password|credential/i, L.eventPassword],
    [/two.?factor|totp|factor/i, L.eventFactor],
    [/recovery/i, L.eventRecovery],
    [/invitation/i, L.eventInvitation],
    [/ownership/i, L.eventOwnership],
    [/policy/i, L.eventPolicy],
    [/mail|delivery/i, L.eventDelivery],
    [/email|verification/i, L.eventEmail],
    [/link|provider/i, L.eventProvider],
    [/session/i, L.eventSessions],
    [/profile|update-user/i, L.eventProfile],
    [/user\.|account\./i, L.eventAccount],
  ];
  return categories.find(([pattern]) => pattern.test(action))?.[1] ?? L.securityEvent;
}

export function authDeviceName(userAgent: string | null, fallback: string): string {
  if (userAgent === null || userAgent.length === 0) return fallback;
  const browsers: [RegExp, string][] = [
    [/Edg\//, "Edge"],
    [/Firefox\//, "Firefox"],
    [/Chrome\//, "Chrome"],
    [/Safari\//, "Safari"],
  ];
  const platforms: [RegExp, string][] = [
    [/Android/, "Android"],
    [/iPhone|iPad/, "iOS"],
    [/Macintosh/, "macOS"],
    [/Windows/, "Windows"],
    [/Linux/, "Linux"],
  ];
  const browser = browsers.find(([pattern]) => pattern.test(userAgent))?.[1];
  const platform = platforms.find(([pattern]) => pattern.test(userAgent))?.[1];
  return [browser, platform].filter((part) => part !== undefined).join(" · ") || fallback;
}
