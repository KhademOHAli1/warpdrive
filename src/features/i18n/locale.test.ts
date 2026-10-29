import { describe, expect, it } from "vitest";
import { directionForLocale, messagesForLocale, parseLocale } from "./locale";

describe("interface locale", () => {
  it("accepts only supported stored locale values and defaults to English", () => {
    expect(parseLocale("fa")).toBe("fa");
    expect(parseLocale("en")).toBe("en");
    expect(parseLocale(undefined)).toBe("en");
    expect(parseLocale("invalid")).toBe("en");
  });

  it("uses right-to-left direction and contextual Persian copy for Farsi", () => {
    expect(directionForLocale("fa")).toBe("rtl");
    expect(directionForLocale("en")).toBe("ltr");
    expect(messagesForLocale("fa").nav.leads).toBe("سرنخ‌ها");
    expect(messagesForLocale("fa").auth.signInWithGoogle).toBe("ورود با حساب گوگل");
    expect(messagesForLocale("en").auth.signInWithGoogle).toBe("Sign in with Google");
  });
});
