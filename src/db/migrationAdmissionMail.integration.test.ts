import { expect, it } from "vitest";
import { makeTestDb } from "@/test/db";
import { applyMigrations } from "./migrate";
import { freshMigrationDb, installPrefix, ledger } from "./migrationAdmission.test-helpers";
import {
  assertMailRefusal,
  canonicalEntries,
  changeMailPointer,
  installOriginalMailHistory,
  mailFunctions,
  mailPointers,
  mailTriggers,
} from "./migrationAdmissionMail.test-helpers";

it("admits a complete canonical Mail no-op history unchanged", async () => {
  const h = await makeTestDb();
  try {
    const before = await ledger(h);
    expect(await applyMigrations(h.db)).toEqual({ ok: true, value: { applied: true } });
    expect(await ledger(h)).toEqual(before);
  } finally {
    await h.close();
  }
});

it("checks only applied delivery protections before upgrading the canonical prefix to private intake", async () => {
  const h = await freshMigrationDb();
  try {
    const entries = await canonicalEntries();
    const delivery = entries.find((entry) => entry.tag.endsWith("_mail_delivery_observations"));
    if (delivery === undefined) throw new TypeError("missing canonical delivery migration");
    await installPrefix(h, delivery.idx + 1);
    expect(
      (await h.pool.query("SELECT to_regclass('public.email_private_intake') AS value")).rows,
    ).toEqual([{ value: null }]);
    const before = await ledger(h);
    expect(await applyMigrations(h.db)).toEqual({ ok: true, value: { applied: true } });
    expect((await ledger(h)).slice(0, before.length)).toEqual(before);
    expect(await ledger(h)).toHaveLength(entries.length);
    expect(
      (await h.pool.query("SELECT to_regclass('public.email_private_intake')::text AS value")).rows,
    ).toEqual([{ value: "email_private_intake" }]);
  } finally {
    await h.close();
  }
});

it.each(mailFunctions)(
  "refuses a changed security mode for public.%s on an unchanged history",
  async (signature) => {
    const h = await makeTestDb();
    try {
      await h.pool.query(`ALTER FUNCTION public.${signature} SECURITY DEFINER`);
      await assertMailRefusal(h);
    } finally {
      await h.close();
    }
  },
);

it.each([
  "STABLE",
  "CALLED ON NULL INPUT",
  "PARALLEL UNSAFE",
  "SET search_path = public, pg_catalog",
])("refuses a changed hash function attribute: %s", async (attribute) => {
  const h = await makeTestDb();
  try {
    await h.pool.query(`ALTER FUNCTION public.private_intake_hash_v1(jsonb) ${attribute}`);
    await assertMailRefusal(h);
  } finally {
    await h.close();
  }
});

it.each([
  "CREATE OR REPLACE FUNCTION public.private_intake_hash_v1(payload jsonb) RETURNS text LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE SECURITY INVOKER SET search_path = pg_catalog, public AS $$ SELECT repeat('a',64); $$",
  "CREATE OR REPLACE FUNCTION public.email_delivery_report_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$ BEGIN RETURN NEW; END; $$",
])("refuses a replaced canonical Mail function body", async (replacement) => {
  const h = await makeTestDb();
  try {
    await h.pool.query(replacement);
    await assertMailRefusal(h);
  } finally {
    await h.close();
  }
});

it("refuses a missing private baseline function", async () => {
  const h = await makeTestDb();
  try {
    await h.pool.query("DROP FUNCTION public.private_intake_baseline_v1(uuid,uuid)");
    await assertMailRefusal(h);
  } finally {
    await h.close();
  }
});

for (const trigger of mailTriggers) {
  it.each(["condition", "columns", "disabled", "arguments"] as const)(
    `refuses a changed ${trigger.name} trigger: %s`,
    async (change) => {
      const h = await makeTestDb();
      try {
        if (change === "disabled") {
          await h.pool.query(`ALTER TABLE public.${trigger.table} DISABLE TRIGGER ${trigger.name}`);
        } else {
          await h.pool.query(`DROP TRIGGER ${trigger.name} ON public.${trigger.table}`);
          const events =
            change === "columns"
              ? trigger.events.replace("UPDATE", "UPDATE OF account_id")
              : trigger.events;
          const condition = change === "condition" ? "WHEN (false) " : "";
          const args = change === "arguments" ? "'unexpected'" : "";
          await h.pool.query(
            `CREATE TRIGGER ${trigger.name} BEFORE ${events} ON public.${trigger.table} FOR EACH ROW ${condition}EXECUTE FUNCTION public.${trigger.function}(${args})`,
          );
        }
        await assertMailRefusal(h);
      } finally {
        await h.close();
      }
    },
  );
}

for (const pointer of mailPointers) {
  it(`refuses a disabled internal delete-action trigger for ${pointer.name}`, async () => {
    const h = await makeTestDb();
    try {
      const result = await h.pool.query<{ name: string }>(
        "SELECT t.tgname AS name FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_constraint c ON c.oid=t.tgconstraint WHERE c.conname=$1 AND c.conrelid=$2::regclass AND t.tgrelid=c.confrelid AND t.tgisinternal AND (t.tgtype & 8)=8",
        [pointer.name, `public.${pointer.table}`],
      );
      expect(result.rows).toHaveLength(1);
      const trigger = result.rows[0];
      if (trigger === undefined) throw new TypeError("missing internal FK delete trigger");
      const quoted = trigger.name.replaceAll('"', '""');
      await h.pool.query(`ALTER TABLE public.${pointer.target} DISABLE TRIGGER "${quoted}"`);
      await assertMailRefusal(h);
    } finally {
      await h.close();
    }
  });

  it.each([
    "missing",
    "wrong_null_column",
    "all_null_columns",
    "nullable_account",
    "wrong_target",
    "update_cascade",
    "unvalidated",
  ] as const)(`refuses changed pointer-only semantics for ${pointer.name}: %s`, async (change) => {
    const h = await makeTestDb();
    try {
      await changeMailPointer(h, pointer, change);
      await assertMailRefusal(h);
    } finally {
      await h.close();
    }
  });
}

it("rejects actual original MAIL94 history without applying or rewriting canonical history", async () => {
  const h = await freshMigrationDb();
  try {
    await installOriginalMailHistory(h);
    const before = await ledger(h);
    expect(await applyMigrations(h.db)).toEqual({
      ok: false,
      error: "unsupported migration history: expected an exact canonical prefix",
    });
    expect(await ledger(h)).toEqual(before);
    expect(
      (
        await h.pool.query(
          "SELECT to_regclass('public.email_private_intake')::text AS intake, to_regclass('public.privacy_cases') AS privacy",
        )
      ).rows,
    ).toEqual([{ intake: "email_private_intake", privacy: null }]);
  } finally {
    await h.close();
  }
});
