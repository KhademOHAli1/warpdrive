import { describe, expect, it } from "vitest";
import { parseLegacyTagIdentifier, previewLegacyTagCsv } from "./legacyImport";

const shelf = "https://shelf.example.test:8080";
const legacy = "shelf9d2tg";
const otherLegacy = "other3a7bc";
const asset = "11111111-1111-4111-8111-111111111111";
const kit = "22222222-2222-4222-8222-222222222222";
const header = "identifier,target_kind,target_id";

describe("legacy Shelf identifiers", () => {
  it("retains IDs from bare text, the official shortener, or one authorized self-host", () => {
    expect(parseLegacyTagIdentifier(legacy)).toEqual({ id: legacy, origin: null });
    expect(parseLegacyTagIdentifier(`]Q1https://eam.sh/${legacy}\r\n`)).toEqual({
      id: legacy,
      origin: "https://eam.sh",
    });
    expect(parseLegacyTagIdentifier(`${shelf}/qr/${legacy}`, `${shelf}/`)).toEqual({
      id: legacy,
      origin: shelf,
    });
    expect(parseLegacyTagIdentifier(`${shelf}/qr/${legacy}`)).toBeNull();
    expect(
      parseLegacyTagIdentifier(`${shelf}/qr/${legacy}`, "https://alternate.example.test"),
    ).toBeNull();
  });

  it("rejects malformed IDs and links outside the approved exact path", () => {
    for (const invalid of [
      "allletters",
      "1helf9d2tg",
      legacy.toUpperCase(),
      "a12",
      `https://eam.sh/qr/${legacy}`,
      `https://eam.sh/${legacy}?external=1`,
      `https://eam.sh/${legacy}#`,
      `http://eam.sh/${legacy}`,
      `https://eam.sh@example.net/${legacy}`,
      `https://eam.sh.bad-domain.test/${legacy}`,
      `${shelf}/qr/%73helf9d2tg`,
      `${shelf}/else/../qr/${legacy}`,
      `${shelf}/qr/${legacy}/`,
      ` ${legacy}`,
      `/qr/${legacy}`,
    ]) {
      expect(parseLegacyTagIdentifier(invalid, shelf), invalid).toBeNull();
    }
  });
});

describe("legacy tag CSV preview", () => {
  it("accepts a BOM, quoted cells, CRLF and transports physical row numbers", () => {
    const csv = [
      '\uFEFF"identifier", "target_kind", "target_id"',
      "",
      `"https://eam.sh/${legacy}", "asset", "${asset}"`,
      "   ",
      `"${shelf}/qr/${otherLegacy}", kit, "${kit}"`,
    ].join("\r\n");
    expect(previewLegacyTagCsv(csv, shelf)).toEqual({
      ok: true,
      rows: [
        { row: 3, identifier: `https://eam.sh/${legacy}`, target: { kind: "asset", id: asset } },
        { row: 5, identifier: `${shelf}/qr/${otherLegacy}`, target: { kind: "kit", id: kit } },
      ],
    });
  });

  it("reports all row validation errors without interpreting formulas or quoted junk", () => {
    const csv = [
      header,
      "",
      "https://wrong.example.test/test,location,0",
      `"${legacy}, suffix",asset,${asset}`,
      `"${legacy}""suffix",asset,${asset}`,
      `"${legacy}" stray,asset,${asset}`,
      `"${legacy},asset,${asset}`,
      `=HYPERLINK("https://example.test"),kit,${kit}`,
    ].join("\n");
    expect(previewLegacyTagCsv(csv)).toEqual({
      ok: false,
      errors: [
        { row: 3, error: "identifier" },
        { row: 3, error: "target_kind" },
        { row: 3, error: "target_id" },
        { row: 4, error: "identifier" },
        { row: 5, error: "identifier" },
        { row: 6, error: "malformed" },
        { row: 7, error: "malformed" },
        { row: 8, error: "malformed" },
      ],
    });
  });

  it("rejects repeated aliases across representations and repeated targets", () => {
    const csv = [
      header,
      `${legacy},asset,${asset}`,
      `https://eam.sh/${legacy},kit,${kit}`,
      `${shelf}/qr/${legacy},asset,${asset}`,
      `${otherLegacy},kit,${kit}`,
    ].join("\n");
    expect(previewLegacyTagCsv(csv, shelf)).toEqual({
      ok: false,
      errors: [
        { row: 3, error: "duplicate_identifier" },
        { row: 4, error: "duplicate_identifier" },
        { row: 4, error: "duplicate_target" },
        { row: 5, error: "duplicate_target" },
      ],
    });
  });

  it("normalizes target UUIDs and bounds empty, incompatible, or oversized imports", () => {
    const upper = "aAAAAAAA-AAAA-4AAA-8AAA-AAAAaaaaaAAA";
    expect(previewLegacyTagCsv(`${header}\n${legacy},asset,${upper}`)).toEqual({
      ok: true,
      rows: [{ row: 2, identifier: legacy, target: { kind: "asset", id: upper.toLowerCase() } }],
    });
    expect(previewLegacyTagCsv("")).toEqual({ ok: false, errors: [{ row: 1, error: "empty" }] });
    expect(previewLegacyTagCsv(header)).toEqual({
      ok: false,
      errors: [{ row: 2, error: "empty" }],
    });
    expect(previewLegacyTagCsv(`\n${header},extra`)).toEqual({
      ok: false,
      errors: [{ row: 2, error: "header" }],
    });
    expect(previewLegacyTagCsv(`${header}\n${`${legacy},asset,${asset}\n`.repeat(101)}`)).toEqual({
      ok: false,
      errors: [{ row: 102, error: "limit" }],
    });
    expect(previewLegacyTagCsv("x".repeat(65_537))).toEqual({
      ok: false,
      errors: [{ row: 1, error: "limit" }],
    });
  });
});
