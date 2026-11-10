import assert from "node:assert/strict";
import { describe, expect, test } from "vitest";
import { buildRetentionPreview } from "./retentionPreview";
import type {
  LegacyAuthMailMetadata,
  LegacyAuthSecurityMetadata,
  RetentionMetadataRow,
  RetentionPreview,
  RetentionPreviewInput,
  RetentionTarget,
} from "./retentionPreviewSchemas";

const ID = "00000000-0000-4000-8000-000000000001";
const OTHER_ID = "00000000-0000-4000-8000-000000000002";
const PRIVATE = "PRIVATE_retention_content_must_not_be_reflected";
const signal = () => new AbortController().signal;
const mail = (changes: Partial<LegacyAuthMailMetadata> = {}): LegacyAuthMailMetadata => ({
  store: "auth_mail_outbox",
  recordRef: ID,
  createdAt: "2026-04-01T12:00:00Z",
  status: "captured",
  bodyPresent: true,
  holds: [],
  ...changes,
});
const audit = (changes: Partial<LegacyAuthSecurityMetadata> = {}): LegacyAuthSecurityMetadata => ({
  store: "auth_security_events",
  recordRef: ID,
  createdAt: "2026-04-01T12:00:00Z",
  holds: [],
  ...changes,
});
const input = (rows: readonly RetentionMetadataRow[] = []): RetentionPreviewInput => ({
  asOf: "2026-11-02T12:00:00Z",
  cutoffs: { authBodyBefore: "2026-10-26T12:00:00Z", authMetadataBefore: "2026-05-06T12:00:00Z" },
  rows,
});
function preview(raw: unknown): RetentionPreview {
  const result = buildRetentionPreview(raw, signal());
  assert(result.ok, "well-formed supplied metadata must produce a non-executable preview");
  return result.value;
}
function rule(value: RetentionPreview, target: RetentionTarget) {
  const found = value.rules.find((entry) => entry.target === target);
  assert(found, "the exact legacy target must be present");
  return found;
}

describe("supplied-metadata retention preview contract", () => {
  test("describes exactly three legacy rules without granting execution or live completeness", () => {
    const value = preview(input());
    expect(value).toMatchObject({
      formatVersion: 1,
      executable: false,
      scope: "supplied_metadata_only",
      sampleRows: 0,
      legacyDefaults: { authBodyDays: 7, authMetadataDays: 180 },
      blockers: [],
      uniqueMatches: { total: 0, held: 0, unknownHold: 0, unheld: 0 },
    });
    expect(
      value.rules.map(({ target, anchor, period, comparison, statuses, before }) => ({
        target,
        anchor,
        period,
        comparison,
        statuses,
        before,
      })),
    ).toEqual([
      {
        target: "auth_mail_body",
        anchor: "created_at",
        period: { days: 7 },
        comparison: "strictly_before",
        statuses: ["sent", "captured", "cancelled"],
        before: input().cutoffs.authBodyBefore,
      },
      {
        target: "auth_mail_metadata",
        anchor: "created_at",
        period: { days: 180 },
        comparison: "strictly_before",
        statuses: ["sent", "captured", "cancelled", "failed"],
        before: input().cutoffs.authMetadataBefore,
      },
      {
        target: "auth_security_metadata",
        anchor: "created_at",
        period: { days: 180 },
        comparison: "strictly_before",
        statuses: null,
        before: input().cutoffs.authMetadataBefore,
      },
    ]);
    expect(Object.keys(value).sort()).toEqual([
      "asOf",
      "blockers",
      "cutoffs",
      "executable",
      "formatVersion",
      "holdCoverage",
      "legacyDefaults",
      "rules",
      "sampleRows",
      "scope",
      "uniqueMatches",
    ]);
  });

  test.each([
    { status: "sent", body: 1, metadata: 1 },
    { status: "captured", body: 1, metadata: 1 },
    { status: "cancelled", body: 1, metadata: 1 },
    { status: "failed", body: 0, metadata: 1 },
    { status: "pending", body: 0, metadata: 0 },
    { status: "sending", body: 0, metadata: 0 },
  ] as const)("preserves legacy $status eligibility", ({ status, body, metadata }) => {
    const value = preview(input([mail({ status })]));
    expect(rule(value, "auth_mail_body").matches).toBe(body);
    expect(rule(value, "auth_mail_metadata").matches).toBe(metadata);
    expect(rule(value, "auth_security_metadata").matches).toBe(0);
  });

  test("audit metadata has no outbox status requirement", () => {
    const value = preview(input([audit()]));
    expect(rule(value, "auth_security_metadata").matches).toBe(1);
    expect(rule(value, "auth_mail_metadata").matches).toBe(0);
  });

  const boundaries = [
    ["auth_mail_body", "2026-10-26T11:59:59.999999Z", 1],
    ["auth_mail_body", "2026-10-26T12:00:00Z", 0],
    ["auth_mail_body", "2026-10-26T12:00:00.000001Z", 0],
    ["auth_mail_metadata", "2026-05-06T11:59:59.999999Z", 1],
    ["auth_mail_metadata", "2026-05-06T12:00:00Z", 0],
    ["auth_mail_metadata", "2026-05-06T12:00:00.000001Z", 0],
    ["auth_security_metadata", "2026-05-06T11:59:59.999999Z", 1],
    ["auth_security_metadata", "2026-05-06T12:00:00Z", 0],
    ["auth_security_metadata", "2026-05-06T12:00:00.000001Z", 0],
  ] as const;
  test.each(boundaries)(
    "uses strict native-precision boundary %s at %s",
    (target, createdAt, expected) => {
      const row = target === "auth_security_metadata" ? audit({ createdAt }) : mail({ createdAt });
      expect(rule(preview(input([row])), target).matches).toBe(expected);
    },
  );

  test("does not count one old outbox row twice across body and metadata matches", () => {
    const value = preview(input([mail()]));
    expect(rule(value, "auth_mail_body").matches).toBe(1);
    expect(rule(value, "auth_mail_metadata").matches).toBe(1);
    expect(value.uniqueMatches).toEqual({ total: 1, held: 0, unknownHold: 0, unheld: 1 });
  });
  test("separates an already-empty body no-op from its predicate and metadata matches", () => {
    const value = preview(input([mail({ bodyPresent: false })]));
    expect(rule(value, "auth_mail_body")).toMatchObject({ matches: 1, noOpMatches: 1 });
    expect(rule(value, "auth_mail_metadata")).toMatchObject({ matches: 1, noOpMatches: 0 });
    expect(value.uniqueMatches.total).toBe(1);
  });

  test.each([
    { label: "legal", holds: ["legal"], coverage: { held: 1, unknown: 0, none: 0 } },
    { label: "operational", holds: ["operational"], coverage: { held: 1, unknown: 0, none: 0 } },
    { label: "both", holds: ["legal", "operational"], coverage: { held: 1, unknown: 0, none: 0 } },
    { label: "none supplied", holds: [], coverage: { held: 0, unknown: 0, none: 1 } },
    { label: "unknown", holds: null, coverage: { held: 0, unknown: 1, none: 0 } },
    { label: "missing", holds: undefined, coverage: { held: 0, unknown: 1, none: 0 } },
  ] as const)(
    "keeps $label hold facts explicit without changing legacy predicate counts",
    ({ holds, coverage }) => {
      const row: LegacyAuthMailMetadata =
        holds === undefined
          ? {
              store: "auth_mail_outbox",
              recordRef: ID,
              createdAt: "2026-04-01T12:00:00Z",
              status: "captured",
              bodyPresent: true,
            }
          : mail({ holds });
      const value = preview(input([row]));
      expect(value.holdCoverage).toEqual(coverage);
      expect(rule(value, "auth_mail_body")).toMatchObject({
        matches: 1,
        heldMatches: coverage.held,
        unknownHoldMatches: coverage.unknown,
        unheldMatches: coverage.none,
      });
      expect(value.uniqueMatches).toEqual({
        total: 1,
        held: coverage.held,
        unknownHold: coverage.unknown,
        unheld: coverage.none,
      });
      expect(value.blockers).toEqual(coverage.unknown ? ["unknown_hold_data"] : []);
      expect(value.executable).toBe(false);
    },
  );
  test("unknown holds remain visible even for a supplied row outside the cutoffs", () => {
    const value = preview(input([mail({ createdAt: input().asOf, holds: null })]));
    expect(value.holdCoverage).toEqual({ held: 0, unknown: 1, none: 0 });
    expect(value.uniqueMatches.total).toBe(0);
    expect(value.blockers).toEqual(["unknown_hold_data"]);
  });
  test("the same UUID in separate stores names two distinct sampled records", () => {
    const value = preview(input([mail(), audit()]));
    expect(value.sampleRows).toBe(2);
    expect(value.uniqueMatches.total).toBe(2);
  });
  test("canonicalizes equivalent offset instants without day or timezone arithmetic", () => {
    const original = input([mail()]);
    expect(
      preview({
        ...original,
        asOf: "2026-11-02T13:00:00+01:00",
        cutoffs: {
          authBodyBefore: "2026-10-26T14:00:00+02:00",
          authMetadataBefore: "2026-05-06T15:00:00+03:00",
        },
        rows: [mail({ createdAt: "2026-04-01T13:00:00+01:00" })],
      }),
    ).toEqual(preview(original));
  });
  test("preserves supplied cutoffs instead of deriving them from day descriptors", () => {
    const supplied = {
      ...input([mail({ createdAt: "2026-10-26T11:59:59Z" })]),
      cutoffs: {
        authBodyBefore: "2026-10-26T11:59:58Z",
        authMetadataBefore: "2026-05-06T12:00:00Z",
      },
    };
    const value = preview(supplied);
    expect(value.cutoffs).toEqual(supplied.cutoffs);
    expect(rule(value, "auth_mail_body").matches).toBe(0);
  });
  test("accepts100rows without claiming a complete live impact", () => {
    const rows = Array.from({ length: 100 }, (_, i) =>
      mail({
        recordRef: `00000000-0000-4000-8000-${(i + 1).toString(16).padStart(12, "0")}`,
      }),
    );
    const value = preview(input(rows));
    expect(value.sampleRows).toBe(100);
    expect(value.uniqueMatches.total).toBe(100);
    expect(value.scope).toBe("supplied_metadata_only");
    expect(value.executable).toBe(false);
  });
  test("is deterministic under input order and does not echo supplied record IDs", () => {
    const rows = [mail({ holds: null }), audit({ recordRef: OTHER_ID, holds: ["legal"] })];
    const first = preview(input(rows));
    expect(preview(input([...rows].reverse()))).toEqual(first);
    expect(JSON.stringify(first)).not.toContain(ID);
    expect(JSON.stringify(first)).not.toContain(OTHER_ID);
  });
  test("does not mutate frozen input, nested cutoffs, rows or holds", () => {
    const row = Object.freeze(mail({ holds: Object.freeze(["legal"] as const) }));
    const value = input(Object.freeze([row]));
    Object.freeze(value.cutoffs);
    Object.freeze(value);
    const before = JSON.stringify(value);
    preview(value);
    expect(JSON.stringify(value)).toBe(before);
  });
});

describe("retention metadata boundary denial", () => {
  const invalid = [
    ["null root", null],
    ["primitive root", PRIVATE],
    ["array root", []],
    ["surplus content", { ...input(), summary: PRIVATE }],
    ["locale rule", { ...input(), locale: "fa" }],
    ["CRM anchor rule", { ...input(), activeCrm: { enabled: true, days: 180, anchor: PRIVATE } }],
    ["caller authority", { ...input(), actor: { userId: ID } }],
    ["non-array rows", { ...input(), rows: {} }],
    ["unknown store", input([{ ...mail(), store: "persons" } as unknown as RetentionMetadataRow])],
    ["malformed reference", input([mail({ recordRef: PRIVATE })])],
    ["unknown status", input([{ ...mail(), status: "SENT" } as unknown as RetentionMetadataRow])],
    ["nonboolean body", input([{ ...mail(), bodyPresent: 1 } as unknown as RetentionMetadataRow])],
    [
      "surplus audit fields",
      input([{ ...audit(), status: "sent" } as unknown as RetentionMetadataRow]),
    ],
    [
      "unknown row content",
      input([{ ...mail(), payloadEnc: PRIVATE } as unknown as RetentionMetadataRow]),
    ],
    [
      "unknown hold kind",
      input([{ ...mail(), holds: [PRIVATE] } as unknown as RetentionMetadataRow]),
    ],
    ["duplicate hold", input([mail({ holds: ["legal", "legal"] })])],
    [
      "hold override",
      input([{ ...mail(), holdReleasedAt: input().asOf } as unknown as RetentionMetadataRow]),
    ],
    ["invalid date", input([mail({ createdAt: "2026-02-30T12:00:00Z" })])],
    ["date only", input([mail({ createdAt: "2026-04-01" })])],
    ["offset absent", input([mail({ createdAt: "2026-04-01T12:00:00" })])],
    ["infinite date", input([mail({ createdAt: "infinity" })])],
    ["Date object", { ...input(), asOf: new Date("2026-11-02T12:00:00Z") }],
    ["invalid as-of", { ...input(), asOf: PRIVATE }],
    ["invalid cutoff", { ...input(), cutoffs: { ...input().cutoffs, authBodyBefore: PRIVATE } }],
    ["surplus cutoff", { ...input(), cutoffs: { ...input().cutoffs, timezone: "Europe/Berlin" } }],
    ["duplicate row", input([mail(), mail()])],
    [
      "101rows",
      input(
        Array.from({ length: 101 }, (_, i) =>
          mail({
            recordRef: `00000000-0000-4000-8000-${(i + 1).toString(16).padStart(12, "0")}`,
          }),
        ),
      ),
    ],
  ] as const;
  test.each(invalid)("denies %s with one fixed error and no content echo", (_label, raw) => {
    const result = buildRetentionPreview(raw, signal());
    expect(result).toEqual({ ok: false, error: "invalid_input" });
    expect(JSON.stringify(result)).not.toContain(PRIVATE);
  });
  test.each(["PRIVATE_original_abort", { private: "original abort object" }, undefined])(
    "preserves the caller's exact pre-abort reason",
    (reason) => {
      const controller = new AbortController();
      controller.abort(reason);
      let caught: unknown;
      try {
        buildRetentionPreview(input(), controller.signal);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBe(controller.signal.reason);
    },
  );
});

test("a previous preview cannot change the fixed rules of a later preview", () => {
  const earlier = preview(input());
  const body = rule(earlier, "auth_mail_body").statuses;
  const metadata = rule(earlier, "auth_mail_metadata").statuses;
  assert(body !== null && metadata !== null);
  // A consumer may ignore readonly types; frozen output and independent copies are both safe.
  Reflect.set(body, 0, "failed");
  Reflect.set(metadata, 0, "pending");
  const later = preview(input([mail({ status: "failed" })]));
  expect(rule(later, "auth_mail_body").statuses).toEqual(["sent", "captured", "cancelled"]);
  expect(rule(later, "auth_mail_body").matches).toBe(0);
  expect(rule(later, "auth_mail_metadata").statuses).toEqual([
    "sent",
    "captured",
    "cancelled",
    "failed",
  ]);
  expect(rule(later, "auth_mail_metadata").matches).toBe(1);
});
