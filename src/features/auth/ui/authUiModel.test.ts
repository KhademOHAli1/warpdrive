import { describe, expect, it } from "vitest";
import { authScreensMessagesForLocale } from "../authScreensMessages";
import { authErrorMessage, normalizeAuthCode, safeAuthDestination } from "./authUiModel";

describe("authentication input and recovery boundaries", () => {
  it("normalizes Persian and Arabic OTP digits without dropping leading zeroes", () => {
    expect(normalizeAuthCode("۰١۲۳۴۵")).toBe("012345");
    expect(normalizeAuthCode(" ٠٠۱۲۳۴ ")).toBe("001234");
    expect(normalizeAuthCode("AB-cd-1234")).toBe("AB-cd-1234");
  });
  it("rejects cross-origin, malformed and recursive authentication return paths", () => {
    for (const path of [
      "https://evil.test",
      "//evil.test",
      "/\\evil.test",
      "/login",
      "/auth/continue",
    ]) {
      expect(safeAuthDestination(path)).toBe("/pipeline");
    }
    expect(safeAuthDestination("/contacts/people?q=ali")).toBe("/contacts/people?q=ali");
  });
  it("maps server errors to local copy without exposing raw provider details", () => {
    for (const locale of ["fa", "de"] as const) {
      const messages = authScreensMessagesForLocale(locale).flow;
      expect(
        authErrorMessage({ code: "INVALID_PASSWORD", message: "secret upstream trace" }, messages),
      ).toBe(messages.invalidCredentials);
      expect(authErrorMessage({ code: "RATE_LIMIT_EXCEEDED" }, messages)).toBe(
        messages.rateLimited,
      );
      expect(authErrorMessage({ code: "AUTH_CANCELLED" }, messages)).toBe(
        messages.passkeyCancelled,
      );
      expect(
        authErrorMessage({ code: "UNRECOGNIZED", message: "secret upstream trace" }, messages),
      ).toBe(messages.genericError);
    }
  });
});

it("formats security timestamps with the saved calendar and account zone", async () => {
  const { formatAuthDate } = await import("./authUiModel");
  const value = "2026-03-20T23:30:00Z";
  const german = {
    locale: "de",
    calendar: "gregory",
    timeZone: "Asia/Tehran",
    numberingSystem: "latn",
  } as const;
  const persian = {
    locale: "fa",
    calendar: "gregory",
    timeZone: "Asia/Tehran",
    numberingSystem: "latn",
  } as const;
  expect(formatAuthDate(value, german)).toBe(
    new Intl.DateTimeFormat("de-u-nu-latn", {
      calendar: "gregory",
      timeZone: "Asia/Tehran",
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value)),
  );
  expect(formatAuthDate(value, persian)).toContain("2026");
});

it("describes audit events in the user's language without exposing action ids", async () => {
  const { authEventLabel } = await import("./authUiModel");
  for (const locale of ["fa", "de"] as const) {
    const L = authScreensMessagesForLocale(locale).flow;
    expect(authEventLabel("auth.password.change", L)).toBe(L.eventPassword);
    expect(authEventLabel("invitation.accept", L)).toBe(L.eventInvitation);
    expect(authEventLabel("unknown.internal.action", L)).toBe(L.securityEvent);
  }
});

it("turns a browser user agent into a concise device label without echoing unrecognized data", async () => {
  const { authDeviceName } = await import("./authUiModel");
  expect(
    authDeviceName(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/156.0.0.0 Safari/537.36",
      "Unknown",
    ),
  ).toBe("Chrome · macOS");
  expect(authDeviceName("untrusted arbitrary header", "Unbekanntes Gerät")).toBe(
    "Unbekanntes Gerät",
  );
});
