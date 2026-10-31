import { describe, expect, it } from "vitest";
import { auditCatalogs } from "../../../../scripts/i18n/auditCatalogs";
import { mailboxConnectionMessages, mailboxConnectionTranslator } from "./messages";
import { endpointInput, initialEndpoint, positiveInteger } from "./model";

describe("connection input", () => {
  it("normalizes only numeric fields while preserving credential bytes", () => {
    expect(positiveInteger("۹۹۳", 65535)).toBe(993);
    expect(positiveInteger("٣٦٥", 3650)).toBe(365);
    for (const value of ["", "0", "-1", "1.5", "1e3", "3651", "Infinity"])
      expect(positiveInteger(value, 3650)).toBeNull();
    expect(
      endpointInput({
        ...initialEndpoint("imap"),
        host: "mail.example.com",
        username: "  exact  ",
        password: "  secret  ",
        port: "۹۹۳",
      }),
    ).toEqual({
      host: "mail.example.com",
      username: "  exact  ",
      password: "  secret  ",
      port: 993,
      security: "tls",
    });
  });
});

describe("localized connection workflow", () => {
  it("has complete, independently translated Farsi and German catalogs", () => {
    expect(
      auditCatalogs(
        {
          en: mailboxConnectionMessages("en"),
          fa: mailboxConnectionMessages("fa"),
          de: mailboxConnectionMessages("de"),
        },
        "en",
      ),
    ).toEqual([]);
  });
  it("formats Farsi progress with the selected numbering system", () => {
    expect(
      mailboxConnectionTranslator("fa", "arabext")("progressKnown", {
        processed: "۱۲",
        total: "۲۰",
      }),
    ).toBe("۱۲ از ۲۰ مورد پردازش شد");
    expect(
      mailboxConnectionTranslator("de")("progressKnown", { processed: "12", total: "20" }),
    ).toBe("12 von 20 Einträgen verarbeitet");
  });
});
