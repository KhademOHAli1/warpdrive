import { describe, expect, it } from "vitest";
import { sanitizeErrorEmails, scrubEvent, scrubProperties } from "./scrub";

describe("scrubProperties", () => {
  it("redacts PII-looking keys and keeps safe + posthog keys", () => {
    const out = scrubProperties({
      email: "a@b.com",
      contactName: "Jane",
      body: "hi",
      errorId: "E_PERM_DENIED",
      route: "/pipeline/1",
      $current_url: "http://x",
    });
    expect(out.email).toBe("[redacted]");
    expect(out.contactName).toBe("[redacted]");
    expect(out.body).toBe("[redacted]");
    expect(out.errorId).toBe("E_PERM_DENIED");
    expect(out.route).toBe("/pipeline/1");
    expect(out.$current_url).toBe("http://x");
  });

  it("redacts email addresses from message values", () => {
    expect(scrubProperties({ message: "failed for jane@acme.com" }).message).toBe(
      "failed for [email]",
    );
  });

  it("removes publication anchors and encoded sign-in destinations from analytics", () => {
    const publication = "/published/project/10bab32c-d56b-41ef-87bc-c39ea219769e";
    const result = scrubProperties({
      $pathname: publication,
      $current_url: `https://demo.example/login?returnTo=${encodeURIComponent(publication)}`,
      $set_once: { $initial_referrer: `https://demo.example${publication}` },
    });
    expect(result).toEqual({
      $pathname: "[redacted]",
      $current_url: "[redacted]",
      $set_once: { $initial_referrer: "[redacted]" },
    });
  });
});

describe("private booking calendars", () => {
  it("redacts calendar URLs, nested referrers and copied subscription credentials", () => {
    const token = `wd_booking_${"a".repeat(43)}`;
    const path = "/api/assets/bookings/feeds/11111111-1111-4111-8111-111111111111/calendar.ics";
    const url = `${path}?token=${token}`;
    expect(
      scrubProperties({
        $current_url: url,
        $set_once: { $initial_referrer: encodeURIComponent(path) },
        message: `Calendar error ${token}`,
      }),
    ).toEqual({
      $current_url: "[redacted]",
      $set_once: { $initial_referrer: "[redacted]" },
      message: "[redacted]",
    });
    expect(sanitizeErrorEmails(`Copy failed for ${url}`)).toBe("[redacted]");
  });
});

describe("physical label privacy", () => {
  it("redacts printed label codes and nested scan destinations", () => {
    const code = "wd-label:v1:111111111111111111111A";
    const link = `/operations/scan?code=${encodeURIComponent(code)}`;
    expect(
      scrubProperties({
        $current_url: `/login?returnTo=${encodeURIComponent(link)}`,
        $set_once: { $initial_referrer: link },
        $pathname: "/operations/scan",
        message: `Scan failed for ${code}`,
      }),
    ).toEqual({
      $current_url: "[redacted]",
      $set_once: { $initial_referrer: "[redacted]" },
      $pathname: "/operations/scan",
      message: "[redacted]",
    });
    expect(sanitizeErrorEmails(`Lookup failed: ${link}`)).toBe("[redacted]");
  });

  it("redacts equipment tag links and namespaced tag codes", () => {
    const token = "222222222222222222222A";
    const path = `/equipment-tag/${token}`;
    expect(
      scrubProperties({
        $current_url: `/login?returnTo=${encodeURIComponent(path)}`,
        $set_once: { $initial_referrer: path },
        message: `Scan failed for wd-tag:v1:${token}`,
      }),
    ).toEqual({
      $current_url: "[redacted]",
      $set_once: { $initial_referrer: "[redacted]" },
      message: "[redacted]",
    });
  });
});

describe("sanitizeErrorEmails", () => {
  it("redacts emails from an Error message and stack", () => {
    const out = sanitizeErrorEmails(new Error("failed for jane@acme.com"));
    expect(out).toBeInstanceOf(Error);
    expect((out as Error).message).toBe("failed for [email]");
  });

  it("redacts emails from a bare string", () => {
    expect(sanitizeErrorEmails("bob@x.io broke")).toBe("[email] broke");
  });

  it("passes non-error, non-string values through untouched (same reference)", () => {
    const obj = { cause: "x" };
    expect(sanitizeErrorEmails(obj)).toBe(obj);
  });
});

describe("scrubEvent", () => {
  it("passes null through and scrubs event.properties", () => {
    expect(scrubEvent(null)).toBeNull();
    const ev = { properties: { email: "a@b.com", route: "/x" } };
    const out = scrubEvent(ev);
    expect(out?.properties?.email).toBe("[redacted]");
    expect(out?.properties?.route).toBe("/x");
  });
});
