import { expect, it } from "vitest";
import { decryptCalendarSecret, encryptCalendarSecret } from "./tokenCrypto";

it("reuses the existing authenticated token format with random encryption and neutral errors", () => {
  const a = encryptCalendarSecret("calendar-refresh");
  const b = encryptCalendarSecret("calendar-refresh");
  expect(a.equals(b)).toBe(false);
  expect(a.includes(Buffer.from("calendar-refresh"))).toBe(false);
  expect(decryptCalendarSecret(a)).toEqual({ ok: true, value: "calendar-refresh" });
  const bad = Buffer.from(a);
  bad[0] = (bad[0] ?? 0) ^ 255;
  expect(decryptCalendarSecret(bad)).toEqual({ ok: false, error: { kind: "credential_corrupt" } });
  expect(decryptCalendarSecret(Buffer.alloc(0))).toEqual({
    ok: false,
    error: { kind: "credential_corrupt" },
  });
});
