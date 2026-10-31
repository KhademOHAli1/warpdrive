import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { projectDisclosureRecord } from "./disclosureProjection";

function fixture() {
  const id = randomUUID();
  const source = {
    id,
    name: "نام آزمایشی",
    email: "synthetic@example.test",
    password: "SECRET-PASSWORD",
    accessToken: "SECRET-OAUTH",
    tokenHash: "SECRET-HASH",
    customFields: { secret: "PRIVATE-CUSTOM" },
    ownerId: randomUUID(),
  };
  const include = (name: string, portabilityEligible = true) => ({
    name,
    action: "include",
    reviewed: true,
    reviewId: randomUUID(),
    thirdParty: "none",
    portabilityEligible,
  });
  const review = {
    recordType: "user",
    recordId: id,
    mode: "access",
    approved: true,
    fields: [include("name"), include("email")],
  };
  return { id, source, review, include };
}

test("P08B: explicit allowlists never spread credentials, arbitrary JSON or ownership into a subject record", () => {
  const { source, review } = fixture();
  const result = projectDisclosureRecord(source, review);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.data).toEqual({ name: "نام آزمایشی", email: "synthetic@example.test" });
  expect(JSON.stringify(result)).not.toMatch(/SECRET-|PRIVATE-CUSTOM|ownerId/);
});

test("P08B/C10: selecting secret or unknown fields cannot override the field policy", () => {
  const { source, review, include } = fixture();
  for (const name of [
    "password",
    "accessToken",
    "tokenHash",
    "customFields",
    "ownerId",
    "__proto__",
  ]) {
    expect(projectDisclosureRecord(source, { ...review, fields: [include(name)] })).toEqual({
      ok: false,
      error: "field_forbidden",
    });
  }
  expect(projectDisclosureRecord(source, { ...review, recordType: "auth_accounts" })).toEqual({
    ok: false,
    error: "invalid_record_review",
  });
});

test("P08A/C12: portability and third-party disclosure need their own reviewed decisions", () => {
  const { source, review, include } = fixture();
  expect(
    projectDisclosureRecord(source, {
      ...review,
      mode: "portability",
      fields: [include("name", false)],
    }),
  ).toEqual({ ok: false, error: "portability_ineligible" });
  expect(
    projectDisclosureRecord(source, {
      ...review,
      fields: [{ ...include("email"), thirdParty: "present" }],
    }),
  ).toEqual({ ok: false, error: "third_party_review_required" });
  expect(
    projectDisclosureRecord(source, {
      ...review,
      fields: [{ ...include("email"), reviewed: false }],
    }),
  ).toEqual({ ok: false, error: "review_required" });
});

test("P08B: email content uses an explicit typed redaction and omits unapproved private fields", () => {
  const id = randomUUID();
  const source = {
    id,
    bodyText: "SUBJECT TEXT plus THIRD-PARTY SENTINEL",
    bodyHtml: '<img src="https://remote.example.test/private">',
    toEmails: ["unrelated@example.test"],
    bcc: ["secret@example.test"],
  };
  const field = {
    name: "bodyText",
    action: "redact",
    reviewed: true,
    reviewId: randomUUID(),
    portabilityEligible: true,
    reason: "third_party_rights",
    replacement: "SUBJECT TEXT",
  };
  const review = {
    recordType: "email_message",
    recordId: id,
    mode: "access",
    approved: true,
    fields: [field],
  };
  const result = projectDisclosureRecord(source, review);
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.data).toEqual({ bodyText: "SUBJECT TEXT" });
    expect(JSON.stringify(result)).not.toMatch(
      /THIRD-PARTY|remote\.example|unrelated@example|secret@example|bodyHtml/,
    );
    expect(result.value.fields[0]).toMatchObject({
      action: "redact",
      reason: "third_party_rights",
    });
  }
  expect(
    projectDisclosureRecord(source, {
      ...review,
      fields: [{ ...field, replacement: source.bodyText }],
    }),
  ).toEqual({ ok: false, error: "redaction_required" });
  expect(
    projectDisclosureRecord(source, { ...review, fields: [{ ...field, replacement: undefined }] }),
  ).toEqual({ ok: false, error: "invalid_record_review" });
});

test("C01/C10: substituted IDs, duplicate fields, missing values and invalid typed replacements deny without content leakage", () => {
  const { source, review, include } = fixture();
  expect(projectDisclosureRecord(source, { ...review, recordId: randomUUID() })).toEqual({
    ok: false,
    error: "record_mismatch",
  });
  expect(
    projectDisclosureRecord(source, { ...review, fields: [include("name"), include("name")] }),
  ).toEqual({ ok: false, error: "field_duplicate" });
  expect(projectDisclosureRecord({ ...source, name: undefined }, review)).toEqual({
    ok: false,
    error: "field_invalid",
  });
  expect(projectDisclosureRecord(source, { ...review, approved: false })).toEqual({
    ok: false,
    error: "scope_unapproved",
  });
  const bad = projectDisclosureRecord(source, {
    ...review,
    fields: [
      {
        name: "name",
        action: "redact",
        reviewed: true,
        reviewId: randomUUID(),
        portabilityEligible: true,
        reason: "third_party_rights",
        replacement: { secret: "SECRET-REPLACEMENT" },
      },
    ],
  });
  expect(bad).toEqual({ ok: false, error: "field_invalid" });
  expect(JSON.stringify(bad)).not.toContain("SECRET-");
});

test("C10: malformed source values cannot throw during a redaction comparison", () => {
  const id = randomUUID();
  const review = {
    recordType: "email_message",
    recordId: id,
    mode: "access",
    approved: true,
    fields: [
      {
        name: "bodyText",
        action: "redact",
        reviewed: true,
        reviewId: randomUUID(),
        portabilityEligible: true,
        reason: "third_party_rights",
        replacement: "Reviewed text",
      },
    ],
  };
  expect(projectDisclosureRecord({ id, bodyText: 1n }, review)).toEqual({
    ok: false,
    error: "field_invalid",
  });
});

test("P08A: portability-only exclusions cannot silently remove an access field", () => {
  const { source, review } = fixture();
  expect(
    projectDisclosureRecord(source, {
      ...review,
      fields: [
        {
          name: "name",
          action: "exclude",
          reviewed: true,
          reviewId: randomUUID(),
          reason: "not_portable",
        },
      ],
    }),
  ).toEqual({ ok: false, error: "review_required" });
});

test("P08A: portability-only redaction grounds cannot alter an access field", () => {
  const { source, review } = fixture();
  expect(
    projectDisclosureRecord(source, {
      ...review,
      fields: [
        {
          name: "name",
          action: "redact",
          reviewed: true,
          reviewId: randomUUID(),
          portabilityEligible: true,
          reason: "not_portable",
          replacement: "Reviewed replacement",
        },
      ],
    }),
  ).toEqual({ ok: false, error: "review_required" });
});
