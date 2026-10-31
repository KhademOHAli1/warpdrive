import { describe, expect, test } from "vitest";
import { renderAuthMail } from "./mailTemplates";

describe("localized authentication messages", () => {
  test("administrative access, session and completed recovery notices explain the actual change", () => {
    expect(
      renderAuthMail({
        recipient: "member@example.com",
        kind: "security_change",
        locale: "de",
        detail: "admin_access",
      }).subject,
    ).toContain("Zugriff");
    expect(
      renderAuthMail({
        recipient: "member@example.com",
        kind: "security_change",
        locale: "en",
        detail: "admin_sessions",
      }).subject,
    ).toContain("sessions");
    expect(
      renderAuthMail({
        recipient: "member@example.com",
        kind: "security_change",
        locale: "fa",
        detail: "operator_recovery",
      }).text,
    ).toContain("گذرکلید");
  });
  test("escapes authored content and keeps bearer links out of the subject", () => {
    const mail = renderAuthMail({
      recipient: "invite@example.com",
      kind: "invitation",
      locale: "fa",
      url: "https://app.example.com/auth/invite?token=sensitive",
    });
    expect(mail.subject).not.toContain("sensitive");
    expect(mail.html).toContain('dir="rtl"');
    expect(mail.html).toContain("دعوت");
    expect(mail.html).toContain('dir="ltr"');
  });
  test("supports every delivered kind in German with a useful action or explanation", () => {
    for (const kind of [
      "invitation",
      "verification",
      "password_reset",
      "security_change",
      "recovery",
    ] as const) {
      const mail = renderAuthMail({
        recipient: "user@example.com",
        kind,
        locale: "de",
        url: "https://app.example.com/auth/continue",
        detail: "factor",
      });
      expect(mail.text.length).toBeGreaterThan(60);
      expect(mail.text).toContain("Warpdrive");
      expect(mail.html).not.toContain("undefined");
    }
  });
});
