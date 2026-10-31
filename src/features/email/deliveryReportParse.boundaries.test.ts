import { expect, it } from "vitest";
import { parseDeliveryReport } from "./deliveryReportParse";

const HEAD = "Reporting-MTA: dns; mx.test";
const RECIPIENT = "Final-Recipient: rfc822; a@example.test\r\nAction: failed\r\nStatus: 5.1.1";
function parse(text: string, global = false) {
  return parseDeliveryReport({
    content: new TextEncoder().encode(text),
    mediaType: global ? "message/global-delivery-status" : "message/delivery-status",
    provenance: "direct",
  });
}

it.each(
  [
    [0xc0, 0xaf],
    [0xed, 0xa0, 0x80],
    [0xf4, 0x90, 0x80, 0x80],
    [0xe2, 0x82],
  ].map((bytes) => ({ bytes })),
)("rejects invalid UTF-8 scalar fixture %#", ({ bytes }) => {
  expect(
    parseDeliveryReport({
      content: new Uint8Array(bytes),
      mediaType: "message/global-delivery-status",
      provenance: "direct",
    }),
  ).toEqual({ ok: false, error: { code: "invalid_utf8" } });
});

it("returns a finite error for hostile input accessors without reflecting their diagnostics", () => {
  const input = Object.defineProperty({}, "content", {
    get: () => {
      throw new Error("private-secret");
    },
  });
  expect(parseDeliveryReport(input)).toEqual({ ok: false, error: { code: "invalid_input" } });
});

it("decodes only the provided byte view and never changes the input", () => {
  const wire = new TextEncoder().encode(`${HEAD}\r\n\r\n${RECIPIENT}`);
  const larger = new Uint8Array(wire.length + 2);
  larger[0] = 0xff;
  larger.set(wire, 1);
  larger[larger.length - 1] = 0xff;
  const snapshot = larger.slice();
  const result = parseDeliveryReport({
    content: larger.subarray(1, -1),
    mediaType: "MESSAGE/DELIVERY-STATUS",
    provenance: "direct",
    trust: "authenticated",
    requiresReview: false,
  });
  expect(result).toMatchObject({
    ok: true,
    value: { trust: "unverified", requiresReview: true, correlationAuthority: false },
  });
  expect(larger).toEqual(snapshot);
});

it("handles comment semicolons without deleting opaque address text", () => {
  const result = parse(
    `Reporting-MTA: dns (internal; note); mx.test\r\n\r\nFinal-Recipient: rfc822; "name;(literal)"@example.test\r\nAction: failed\r\nStatus: 5.1.1`,
  );
  expect(result).toMatchObject({
    ok: true,
    value: {
      reportingMta: { type: "dns", value: "mx.test" },
      recipients: [{ finalRecipient: { value: '"name;(literal)"@example.test' } }],
    },
  });
});

it.each(["fai(comment)led", "failed (unterminated", "failed)"])(
  "rejects malformed action token %s",
  (action) => {
    const result = parse(
      `${HEAD}\r\n\r\n${RECIPIENT.replace("Action: failed", `Action: ${action}`)}`,
    );
    expect(result.ok).toBe(false);
  },
);

it("rejects comments inserted within a numeric status token", () => {
  expect(parse(`${HEAD}\r\n\r\n${RECIPIENT.replace("5.1.1", "5.1.(hidden)1")}`)).toEqual({
    ok: false,
    error: { code: "invalid_status" },
  });
});

it("bounds nested comments, unfolded fields and field counts", () => {
  expect(
    parse(
      `${HEAD}\r\n\r\n${RECIPIENT.replace("Action: failed", `Action: failed ${"(".repeat(17)}x${")".repeat(17)}`)}`,
    ),
  ).toEqual({ ok: false, error: { code: "limit_exceeded" } });
  expect(
    parse(
      `${HEAD}\r\nX-Long: ${"a".repeat(3000)}\r\n ${"b".repeat(3000)}\r\n ${"c".repeat(3000)}\r\n\r\n${RECIPIENT}`,
    ),
  ).toEqual({ ok: false, error: { code: "limit_exceeded" } });
  expect(
    parse(
      `${HEAD}\r\n${Array.from({ length: 64 }, () => "X-Extra: x").join("\r\n")}\r\n\r\n${RECIPIENT}`,
    ),
  ).toEqual({ ok: false, error: { code: "limit_exceeded" } });
});

it("accepts exactly 128KiB and rejects the next byte", () => {
  let text = `${HEAD}\r\n\r\n${RECIPIENT}`;
  while (text.length + 4008 < 128 * 1024) text += `\r\nX-Pad: ${"x".repeat(4000)}`;
  const remaining = 128 * 1024 - text.length - "\r\nX-Pad: ".length;
  text += `\r\nX-Pad: ${"x".repeat(remaining)}`;
  expect(new TextEncoder().encode(text)).toHaveLength(128 * 1024);
  expect(parse(text).ok).toBe(true);
  expect(parse(`${text}x`)).toEqual({ ok: false, error: { code: "limit_exceeded" } });
});

it("counts diagnostic bounds in UTF-8 bytes rather than UTF-16 characters", () => {
  expect(
    parse(`${HEAD}\r\n\r\n${RECIPIENT}\r\nDiagnostic-Code: smtp; ${"س".repeat(1024)}`, true).ok,
  ).toBe(true);
  expect(
    parse(`${HEAD}\r\n\r\n${RECIPIENT}\r\nDiagnostic-Code: smtp; ${"س".repeat(1025)}`, true),
  ).toEqual({ ok: false, error: { code: "limit_exceeded" } });
});

it.each(["fa_IR", "de-a", "en-a-foo-a-bar", "en-1901-1901", "x"])(
  "rejects malformed language tag %s",
  (tag) => {
    expect(
      parse(
        `${HEAD}\r\n\r\n${RECIPIENT}\r\nDiagnostic-Code: smtp; 550 failure\r\nLocalized-Diagnostic: ${tag}; failure`,
        true,
      ),
    ).toEqual({ ok: false, error: { code: "invalid_diagnostic" } });
  },
);

it("requires global format for localized diagnostics and caps their count", () => {
  expect(
    parse(
      `${HEAD}\r\n\r\n${RECIPIENT}\r\nDiagnostic-Code: smtp; 550 failure\r\nLocalized-Diagnostic: en; failure`,
    ),
  ).toEqual({ ok: false, error: { code: "invalid_diagnostic" } });
  const localized = Array.from(
    { length: 9 },
    (_, index) => `Localized-Diagnostic: x-${index}; failure`,
  ).join("\r\n");
  expect(
    parse(
      `${HEAD}\r\n\r\n${RECIPIENT}\r\nDiagnostic-Code: smtp; 550 failure\r\n${localized}`,
      true,
    ),
  ).toEqual({ ok: false, error: { code: "limit_exceeded" } });
});

it("rejects scope-confused fields and reports only finite errors", () => {
  const result = parse(`${HEAD}\r\n\r\n${RECIPIENT}\r\nReporting-MTA: dns; private-secret`);
  expect(result).toEqual({ ok: false, error: { code: "malformed_field" } });
  expect(JSON.stringify(result)).not.toContain("private-secret");
});
