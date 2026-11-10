import assert from "node:assert/strict";
import { afterEach, beforeEach, expect, test } from "vitest";
import { makeTestDb, type TestDb } from "@/test/db";
import { authoritySignal } from "./authority.test-helpers";
import { loadPrivacyNativeSubjectReview } from "./nativeSubjectReview";
import { durableSubjectReviewSnapshot } from "./nativeSubjectReview.barrier.test-helpers";
import {
  type SubjectReviewFixture,
  subjectReviewFixture,
} from "./nativeSubjectReview.test-helpers";

let h: TestDb;
beforeEach(async () => {
  h = await makeTestDb();
});
afterEach(async () => {
  await h.close();
});
const load = (f: SubjectReviewFixture) =>
  loadPrivacyNativeSubjectReview(
    h.db,
    f.reviewer.actor,
    { caseId: f.privacyCase.id },
    authoritySignal(),
  );
async function fails(f: SubjectReviewFixture, error: "source_limit" | "source_invalid") {
  const before = await durableSubjectReviewSnapshot(h, f);
  expect(await load(f)).toEqual({ ok: false, error });
  expect(await durableSubjectReviewSnapshot(h, f)).toEqual(before);
}
async function points(f: SubjectReviewFixture, column: "emails" | "phones", value: unknown) {
  // Only these two literal test-owned identifiers may enter SQL; values stay parameters.
  await h.pool.query(`UPDATE persons SET ${column}=$1::jsonb WHERE id=$2`, [
    JSON.stringify(value),
    f.contact.id,
  ]);
}

for (const mode of ["valid astral boundary", "UTF16 overflow"] as const)
  test(`P08/C11: ${mode} keeps the existing JavaScript string-length semantics`, async () => {
    const f = await subjectReviewFixture(h, "user");
    const count = mode === "valid astral boundary" ? 524288 : 524289;
    await h.pool.query("UPDATE users SET name=repeat($1,$2) WHERE id=$3", [
      "🚀",
      count,
      f.workforce.id,
    ]);
    const before = await durableSubjectReviewSnapshot(h, f);
    const result = await load(f);
    if (mode === "UTF16 overflow") expect(result).toEqual({ ok: false, error: "source_limit" });
    else {
      expect(result.ok).toBe(true);
      assert(result.ok);
      expect(result.value.record.values.name).toBe("🚀".repeat(count));
      expect(result.value.record.values.name.length).toBe(1048576);
      expect(result.value).toMatchObject({
        state: "preliminary",
        complete: false,
        reviewRequired: true,
      });
    }
    expect(await durableSubjectReviewSnapshot(h, f)).toEqual(before);
  });

for (const column of ["emails", "phones"] as const) {
  for (const root of ["null", "object", "string"] as const)
    test(`C11: ${column} malformed ${root} root is a static source_invalid result`, async () => {
      const f = await subjectReviewFixture(h);
      await points(f, column, root === "null" ? null : root === "object" ? {} : "synthetic");
      await fails(f, "source_invalid");
    });

  for (const field of ["label type", "value type", "primary type", "missing value"] as const)
    test(`C11: ${column} nested ${field} never produces partial values`, async () => {
      const f = await subjectReviewFixture(h);
      const item =
        field === "label type"
          ? { label: 42, value: "synthetic" }
          : field === "value type"
            ? { label: "synthetic", value: ["PRIVATE-NESTED-VALUE"] }
            : field === "primary type"
              ? { label: "synthetic", value: "synthetic", primary: "yes" }
              : { label: "synthetic" };
      await points(f, column, [item]);
      await fails(f, "source_invalid");
    });

  for (const field of ["label", "value"] as const)
    test(`C11: ${column} oversized ${field} maps to source_limit`, async () => {
      const f = await subjectReviewFixture(h);
      await points(f, column, [
        {
          label: "l".repeat(field === "label" ? 201 : 200),
          value: "v".repeat(field === "value" ? 1001 : 1000),
        },
      ]);
      await fails(f, "source_limit");
    });

  test(`P08: ${column} accepts valid astral contact-point limits`, async () => {
    const f = await subjectReviewFixture(h);
    const expected = [{ label: "🚀".repeat(100), value: "🚀".repeat(500), primary: false }];
    await points(f, column, expected);
    const before = await durableSubjectReviewSnapshot(h, f);
    const result = await load(f);
    expect(result.ok).toBe(true);
    assert(result.ok && result.value.record.store === "persons");
    expect(result.value.record.values[column]).toEqual(expected);
    expect(await durableSubjectReviewSnapshot(h, f)).toEqual(before);
  });

  test(`P08: ${column} accepts escaped valid worst-case point arrays without banning TOAST`, async () => {
    const f = await subjectReviewFixture(h);
    const control = String.fromCharCode(1);
    const expected = Array.from({ length: 1000 }, () => ({
      label: control.repeat(200),
      value: control.repeat(1000),
      primary: false,
    }));
    await points(f, column, expected);
    const size = await h.pool.query<{ bytes: number }>(
      `SELECT octet_length(${column}::text) AS bytes FROM persons WHERE id=$1`,
      [f.contact.id],
    );
    assert(
      (size.rows[0]?.bytes ?? 0) > 7000000,
      "SETUP: expected a large valid escaped JSONB representation",
    );
    assert(
      (size.rows[0]?.bytes ?? Infinity) < 8388608,
      "SETUP: valid point fixture exceeded proposed transfer guard",
    );
    const before = await durableSubjectReviewSnapshot(h, f);
    const result = await load(f);
    expect(result.ok).toBe(true);
    assert(result.ok && result.value.record.store === "persons");
    expect(result.value.record.values[column]).toEqual(expected);
    expect(await durableSubjectReviewSnapshot(h, f)).toEqual(before);
  });
}

test("C11: the distinct eight-MiB JSONB transfer guard returns only source_limit", async () => {
  const f = await subjectReviewFixture(h);
  await h.pool.query(
    `UPDATE persons SET emails=jsonb_build_array(jsonb_build_object(
    'label','synthetic','value','synthetic','oversized',repeat('x',8388609))) WHERE id=$1`,
    [f.contact.id],
  );
  const shape = await h.pool.query<{ count: number; bytes: number }>(
    "SELECT jsonb_array_length(emails) AS count, octet_length(emails::text) AS bytes FROM persons WHERE id=$1",
    [f.contact.id],
  );
  expect(shape.rows[0]?.count).toBe(1);
  expect(shape.rows[0]?.bytes).toBeGreaterThan(8388608);
  await fails(f, "source_limit");
  // This static outcome does not measure PG-to-driver traffic or server working memory.
});
