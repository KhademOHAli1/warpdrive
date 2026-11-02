import { describe, expect, it } from "vitest";
import { parseDeliveryReport } from "./deliveryReportParse";
import type { DeliveryReportInput } from "./deliveryReportTypes";

const MESSAGE =
  "Reporting-MTA: dns; mx.example.test\r\nOriginal-Envelope-Id: Opaque-Case-Sensitive";
const RECIPIENT = "Final-Recipient: rfc822; Person@Example.test\r\nAction: failed\r\nStatus: 5.1.1";
function report(
  text = `${MESSAGE}\r\n\r\n${RECIPIENT}\r\n`,
  extra: Partial<DeliveryReportInput> = {},
) {
  return parseDeliveryReport({
    content: new TextEncoder().encode(text),
    mediaType: "message/delivery-status",
    provenance: "direct",
    ...extra,
  });
}
function parsed(text?: string, extra?: Partial<DeliveryReportInput>) {
  const result = report(text, extra);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("expected valid DSN fixture");
  return result.value;
}

describe("untrusted RFC delivery observations", () => {
  it("parses required fields and preserves opaque address/envelope spelling", () => {
    expect(parsed()).toMatchObject({
      mediaType: "message/delivery-status",
      provenance: "direct",
      trust: "unverified",
      requiresReview: true,
      correlationAuthority: false,
      reportingMta: { type: "dns", value: "mx.example.test" },
      originalEnvelopeId: "Opaque-Case-Sensitive",
      recipients: [
        {
          finalRecipient: { type: "rfc822", value: "Person@Example.test" },
          originalRecipient: null,
          action: "failed",
          status: "5.1.1",
          statusClass: 5,
          terminalReport: true,
          actionStatus: "consistent",
        },
      ],
    });
  });
  it.each(["direct", "nested", "forwarded"] as const)(
    "cannot gain correlation authority from %s provenance or forged identifiers",
    (provenance) => {
      const text = `${MESSAGE}\r\nMessage-ID: <victim@example.test>\r\nX-Warpdrive-Send-Attempt: 00000000-0000-4000-8000-000000000001\r\nX-Verified: yes\r\n\r\n${RECIPIENT}`;
      const value = parsed(text, { provenance });
      expect(value).toMatchObject({
        provenance,
        trust: "unverified",
        requiresReview: true,
        correlationAuthority: false,
      });
      expect(value).not.toHaveProperty("attemptId");
      expect(value).not.toHaveProperty("matchedMessageId");
      expect(value.extensions).toContainEqual({
        name: "message-id",
        value: "<victim@example.test>",
      });
    },
  );
  it("unfolds header continuations and handles comments and case-insensitive names/types", () => {
    const value = parsed(
      "rEpOrTiNg-MtA: DNS (gateway);\r\n\tmx.example.test\r\n\r\nFinal-Recipient: RFC822; Person@Example.test\r\nAction: FAILED (final (nested))\r\nStatus: 4.4.7 (expired)\r\nDiagnostic-Code: SMTP; 450 delayed\r\n  until queue expired (original wording)\r\n",
    );
    expect(value.recipients[0]).toMatchObject({
      action: "failed",
      status: "4.4.7",
      terminalReport: true,
      actionStatus: "consistent",
      diagnostic: {
        type: "smtp",
        text: "450 delayed until queue expired (original wording)",
        display: "plain_text",
      },
    });
    expect(value.reportingMta).toEqual({ type: "dns", value: "mx.example.test" });
  });
  it.each([
    ["failed", "4.4.7", true, "consistent"],
    ["failed", "5.1.1", true, "consistent"],
    ["delayed", "4.2.0", false, "consistent"],
    ["delivered", "2.0.0", true, "consistent"],
    ["relayed", "2.0.0", false, "consistent"],
    ["expanded", "2.0.0", false, "consistent"],
    ["delivered", "5.1.1", true, "conflict"],
    ["failed", "2.0.0", true, "conflict"],
    ["relayed", "5.6.0", false, "conflict"],
  ] as const)(
    "preserves %s + %s without inferring a delivery fact",
    (action, status, terminalReport, actionStatus) => {
      const value = parsed(
        `${MESSAGE}\r\n\r\nFinal-Recipient: rfc822; a@example.test\r\nAction: ${action}\r\nStatus: ${status}`,
      );
      expect(value.recipients[0]).toMatchObject({ action, status, terminalReport, actionStatus });
      expect(value.correlationAuthority).toBe(false);
    },
  );
  it("retains independent recipient blocks, optional fields and foreign address types", () => {
    const value = parsed(
      `${MESSAGE}\r\nArrival-Date: Sat, 31 Oct 2026 09:00:00 +0000\r\nDSN-Gateway: dns; gateway.test\r\nReceived-From-MTA: dns; source.test\r\n\r\n${RECIPIENT}\r\nOriginal-Recipient: rfc822; Original+Tag@Example.test\r\nRemote-MTA: dns; Remote.Example.test\r\nLast-Attempt-Date: Sat, 31 Oct 2026 10:00:00 +0000\r\nWill-Retry-Until: Sun, 01 Nov 2026 10:00:00 +0000\r\nFinal-Log-ID: opaque:log\r\n\r\nFinal-Recipient: x400; C=DE;A=EXAMPLE\r\nAction: delayed\r\nStatus: 4.0.0`,
    );
    expect(value.recipients).toHaveLength(2);
    expect(value.recipients[0]).toMatchObject({
      originalRecipient: { type: "rfc822", value: "Original+Tag@Example.test" },
      remoteMta: { type: "dns", value: "Remote.Example.test" },
      finalLogId: "opaque:log",
      willRetryUntil: "Sun, 01 Nov 2026 10:00:00 +0000",
    });
    expect(value.recipients[1]?.finalRecipient).toEqual({ type: "x400", value: "C=DE;A=EXAMPLE" });
    expect(value.arrivalDate).toBe("Sat, 31 Oct 2026 09:00:00 +0000");
  });
  it("preserves encoded addresses without URL decoding, Unicode normalization or alias matching", () => {
    expect(
      parsed(
        `${MESSAGE}\r\n\r\nFinal-Recipient: utf-8; User\\x{2B}tag@Example.test\r\nAction: failed\r\nStatus: 5.0.0`,
      ).recipients[0]?.finalRecipient.value,
    ).toBe("User\\x{2B}tag@Example.test");
  });
  it("keeps dangerous extension names in arrays without prototype mutation", () => {
    const value = parsed(
      `${MESSAGE}\r\n__proto__: poisoned\r\nconstructor: untrusted\r\n\r\n${RECIPIENT}`,
    );
    expect(value.extensions).toContainEqual({ name: "__proto__", value: "poisoned" });
    expect(Object.hasOwn({}, "poisoned")).toBe(false);
  });
});

describe("internationalized and plain-text diagnostics", () => {
  it("preserves native Persian/German addresses, ZWNJ and localized diagnostics", () => {
    const value = parsed(
      `${MESSAGE}\r\n\r\nFinal-Recipient: utf-8; نام‌کاربر@مثال.ایران\r\nOriginal-Recipient: utf-8; größe@beispiel.de\r\nAction: failed\r\nStatus: 5.1.1\r\nDiagnostic-Code: smtp; 550 گیرنده پیدا نشد · Grüße\r\nLocalized-Diagnostic: fa; گیرنده پیدا نشد\r\nLocalized-Diagnostic: de-DE; Empfänger nicht gefunden`,
      { mediaType: "message/global-delivery-status" },
    );
    expect(value.recipients[0]).toMatchObject({
      finalRecipient: { type: "utf-8", value: "نام‌کاربر@مثال.ایران" },
      originalRecipient: { type: "utf-8", value: "größe@beispiel.de" },
      localizedDiagnostics: [
        { languageTag: "fa", text: "گیرنده پیدا نشد", display: "plain_text" },
        { languageTag: "de-de", text: "Empfänger nicht gefunden", display: "plain_text" },
      ],
    });
  });
  it("retains diagnostic markup as explicitly untrusted plain text", () => {
    const value = parsed(
      `${MESSAGE}\r\n\r\n${RECIPIENT}\r\nDiagnostic-Code: smtp; 550 <img src=x onerror=alert(1)>`,
    );
    expect(value.recipients[0]?.diagnostic).toEqual({
      type: "smtp",
      text: "550 <img src=x onerror=alert(1)>",
      display: "plain_text",
    });
    expect(value).not.toHaveProperty("html");
  });
  it.each(["i-default", "x-provider", "zh-cmn-Hans-CN"])(
    "accepts BCP47 diagnostic tag %s",
    (tag) => {
      const value = parsed(
        `${MESSAGE}\r\n\r\n${RECIPIENT}\r\nDiagnostic-Code: smtp; 550 failure\r\nLocalized-Diagnostic: ${tag}; failure`,
        { mediaType: "message/global-delivery-status" },
      );
      expect(value.recipients[0]?.localizedDiagnostics[0]?.languageTag).toBe(tag.toLowerCase());
    },
  );
});

describe("bounded malformed input", () => {
  it.each([
    null,
    undefined,
    {},
    { content: "text", mediaType: "message/delivery-status", provenance: "direct" },
  ])("rejects invalid input shape %#", (value) => {
    expect(parseDeliveryReport(value)).toEqual({ ok: false, error: { code: "invalid_input" } });
  });
  it("rejects MDN and other media types instead of treating read receipts as delivery reports", () => {
    expect(
      report(undefined, {
        mediaType: "message/disposition-notification" as DeliveryReportInput["mediaType"],
      }),
    ).toEqual({ ok: false, error: { code: "unsupported_media_type" } });
  });
  it.each([
    "Action: failed\r\naction: delivered",
    "Status: 5.1.1\r\nSTATUS: 2.0.0",
    "Final-Recipient: rfc822; a@x.test\r\nFINAL-RECIPIENT: rfc822; b@x.test",
    "Diagnostic-Code: smtp; 550 a\r\nDiagnostic-Code: smtp; 250 b",
  ])("rejects duplicate recipient singleton %#", (fields) => {
    const text = `${MESSAGE}\r\n\r\n${RECIPIENT}\r\n${fields}`;
    expect(report(text)).toEqual({ ok: false, error: { code: "duplicate_field" } });
  });
  it("rejects duplicate envelope identifiers even if they differ only by field-name case", () => {
    expect(report(`${MESSAGE}\r\noriginal-envelope-id: other\r\n\r\n${RECIPIENT}`)).toEqual({
      ok: false,
      error: { code: "duplicate_field" },
    });
  });
  it.each([
    "Reporting-MTA: dns; mx.test",
    `Final-Recipient: rfc822; a@test\r\nAction: failed\r\nStatus: 5.1.1`,
  ])("rejects missing blocks or required fields %#", (text) => {
    expect(report(text)).toEqual({ ok: false, error: { code: "missing_field" } });
  });
  it.each(["5.01.1", "5.1.000", "5.1000.1", "3.1.1", "5.1.1 injected"])(
    "rejects malformed enhanced status %s",
    (status) => {
      expect(
        report(
          `${MESSAGE}\r\n\r\nFinal-Recipient: rfc822; a@x.test\r\nAction: failed\r\nStatus: ${status}`,
        ),
      ).toEqual({ ok: false, error: { code: "invalid_status" } });
    },
  );
  it("rejects unknown actions without returning an inferred bounce", () => {
    expect(report(`${MESSAGE}\r\n\r\n${RECIPIENT.replace("failed", "read")}`)).toEqual({
      ok: false,
      error: { code: "invalid_action" },
    });
  });
  it.each(["orphan\r\n", " folded-without-a-field\r\n", "Broken Header: value\r\n"])(
    "rejects malformed header syntax %#",
    (prefix) => {
      expect(report(`${prefix}${MESSAGE}\r\n\r\n${RECIPIENT}`)).toEqual({
        ok: false,
        error: { code: "malformed_field" },
      });
    },
  );
  it("rejects bare LF/CR, forbidden controls and non-ASCII in the traditional media type", () => {
    expect(report(`${MESSAGE}\r\n\r\n${RECIPIENT}`.replaceAll("\r\n", "\n"))).toEqual({
      ok: false,
      error: { code: "invalid_line_endings" },
    });
    expect(report(`${MESSAGE}\r\n\r\n${RECIPIENT}\r`)).toEqual({
      ok: false,
      error: { code: "invalid_line_endings" },
    });
    expect(
      report(`${MESSAGE}\r\n\r\n${RECIPIENT}\r\nDiagnostic-Code: smtp; private-secret\u001b`),
    ).toEqual({ ok: false, error: { code: "malformed_field" } });
    expect(report(`${MESSAGE}\r\n\r\n${RECIPIENT}\r\nDiagnostic-Code: smtp; Grüße`)).toEqual({
      ok: false,
      error: { code: "non_ascii_dsn" },
    });
  });
  it("rejects malformed UTF-8 rather than replacing bytes", () => {
    expect(
      parseDeliveryReport({
        content: new Uint8Array([0xc3, 0x28]),
        mediaType: "message/global-delivery-status",
        provenance: "direct",
      }),
    ).toEqual({ ok: false, error: { code: "invalid_utf8" } });
  });
  it("rejects duplicate diagnostic language tags case-insensitively", () => {
    expect(
      report(
        `${MESSAGE}\r\n\r\n${RECIPIENT}\r\nDiagnostic-Code: smtp; 550 failure\r\nLocalized-Diagnostic: FA; اول\r\nLocalized-Diagnostic: fa; دوم`,
        { mediaType: "message/global-delivery-status" },
      ),
    ).toEqual({ ok: false, error: { code: "duplicate_field" } });
  });
  it("rejects localized diagnostics without their diagnostic code", () => {
    expect(
      report(`${MESSAGE}\r\n\r\n${RECIPIENT}\r\nLocalized-Diagnostic: fa; نامشخص`, {
        mediaType: "message/global-delivery-status",
      }),
    ).toEqual({ ok: false, error: { code: "invalid_diagnostic" } });
  });
  it("enforces byte, line, diagnostic and recipient-block limits", () => {
    expect(report(undefined, { content: new Uint8Array(128 * 1024 + 1) })).toEqual({
      ok: false,
      error: { code: "limit_exceeded" },
    });
    expect(report(`${MESSAGE}\r\nX-Oversize: ${"x".repeat(4096)}\r\n\r\n${RECIPIENT}`)).toEqual({
      ok: false,
      error: { code: "limit_exceeded" },
    });
    expect(
      report(`${MESSAGE}\r\n\r\n${RECIPIENT}\r\nDiagnostic-Code: smtp; ${"x".repeat(2049)}`),
    ).toEqual({ ok: false, error: { code: "limit_exceeded" } });
    expect(
      parsed(`${MESSAGE}\r\n\r\n${Array.from({ length: 100 }, () => RECIPIENT).join("\r\n\r\n")}`)
        .recipients,
    ).toHaveLength(100);
    expect(
      report(`${MESSAGE}\r\n\r\n${Array.from({ length: 101 }, () => RECIPIENT).join("\r\n\r\n")}`),
    ).toEqual({ ok: false, error: { code: "limit_exceeded" } });
  });
});
