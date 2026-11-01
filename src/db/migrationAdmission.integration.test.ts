import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { makeTestDb } from "@/test/db";
import { applyMigrations } from "./migrate";
import {
  freshMigrationDb,
  installPrefix,
  ledger,
  ledgerExists,
  migrationFolder,
} from "./migrationAdmission.test-helpers";

it("installs a fresh canonical schema and admits its unchanged no-op rerun", async () => {
  const h = await freshMigrationDb();
  try {
    expect(await applyMigrations(h.db)).toEqual({ ok: true, value: { applied: true } });
    const before = await ledger(h);
    expect(await applyMigrations(h.db)).toEqual({ ok: true, value: { applied: true } });
    expect(await ledger(h)).toEqual(before);
  } finally {
    await h.close();
  }
});

it.each([83, 86])(
  "upgrades actual canonical prefix length %i without changing prior ledger or business data",
  async (prefix) => {
    const h = await freshMigrationDb();
    try {
      await installPrefix(h, prefix);
      const before = await ledger(h);
      await h.db.execute(
        sql`INSERT INTO users(id, email, name) VALUES ('00000000-0000-4000-8000-000000000001','migration@example.invalid','Migration fixture')`,
      );
      await h.db.execute(
        sql`INSERT INTO auth_users(id,email,name,email_verified) SELECT id,email,name,true FROM users WHERE id='00000000-0000-4000-8000-000000000001'`,
      );
      await h.db.execute(
        sql`INSERT INTO user_preferences(user_id,ui) VALUES ('00000000-0000-4000-8000-000000000001','{"localePreferences":{"locale":"fa","calendar":"persian","timeZone":"Europe/Berlin","numberingSystem":"latn"}}'::jsonb)`,
      );
      if (prefix === 86)
        await h.db.execute(
          sql`INSERT INTO privacy_cases(kind,created_by,intake_key,intake_digest,metadata_enc) VALUES ('access','00000000-0000-4000-8000-000000000001','migration-fixture','synthetic-digest',decode('00ff81','hex'))`,
        );
      const users = (await h.db.execute(sql`SELECT to_jsonb(u) AS value FROM users u ORDER BY id`))
        .rows;
      const auth = (
        await h.db.execute(sql`SELECT to_jsonb(u) AS value FROM auth_users u ORDER BY id`)
      ).rows;
      const preferences = (
        await h.db.execute(
          sql`SELECT to_jsonb(p) AS value FROM user_preferences p ORDER BY user_id`,
        )
      ).rows;
      expect((await applyMigrations(h.db)).ok).toBe(true);
      expect((await ledger(h)).slice(0, before.length)).toEqual(before);
      expect(
        (await h.db.execute(sql`SELECT to_jsonb(u) AS value FROM users u ORDER BY id`)).rows,
      ).toEqual(users);
      expect(
        (await h.db.execute(sql`SELECT to_jsonb(u) AS value FROM auth_users u ORDER BY id`)).rows,
      ).toEqual(auth);
      expect(
        (
          await h.db.execute(
            sql`SELECT to_jsonb(p) AS value FROM user_preferences p ORDER BY user_id`,
          )
        ).rows,
      ).toEqual(preferences);
      if (prefix === 86)
        expect(
          (
            await h.db.execute(
              sql`SELECT encode(metadata_enc,'hex') AS value FROM privacy_cases WHERE intake_key='migration-fixture'`,
            )
          ).rows,
        ).toEqual([{ value: "00ff81" }]);
    } finally {
      await h.close();
    }
  },
);

it.each(["changed_hash", "missing_middle", "foreign_high_cutoff"] as const)(
  "refuses %s even when stock Drizzle would select no SQL",
  async (scenario) => {
    const h = await makeTestDb();
    try {
      if (scenario === "changed_hash")
        await h.db.execute(
          sql`UPDATE drizzle.__drizzle_migrations SET hash=repeat('c',64) WHERE id=(SELECT min(id) FROM drizzle.__drizzle_migrations)`,
        );
      else if (scenario === "missing_middle")
        await h.db.execute(
          sql`DELETE FROM drizzle.__drizzle_migrations WHERE id=(SELECT min(id)+1 FROM drizzle.__drizzle_migrations)`,
        );
      else
        await h.db.execute(
          sql`INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES(repeat('d',64),9007199254740990)`,
        );
      const before = await ledger(h);
      const result = await applyMigrations(h.db);
      expect(result.ok).toBe(false);
      expect(await ledger(h)).toEqual(before);
    } finally {
      await h.close();
    }
  },
);

it("refuses the real original workflow83 lineage before applying canonical migrations", async () => {
  const h = await freshMigrationDb();
  try {
    await installPrefix(h, 83, true);
    const before = await ledger(h);
    const result = await applyMigrations(h.db);
    expect(result).toEqual({
      ok: false,
      error: "unsupported migration history: expected an exact canonical prefix",
    });
    expect(await ledger(h)).toEqual(before);
    expect(
      (await h.db.execute(sql`SELECT to_regclass('public.privacy_cases') AS value`)).rows,
    ).toEqual([{ value: null }]);
  } finally {
    await h.close();
  }
});

it("refuses a ledgerless application schema without bootstrapping metadata", async () => {
  const h = await makeTestDb();
  try {
    await h.db.execute(sql`DROP SCHEMA drizzle CASCADE`);
    expect((await applyMigrations(h.db)).ok).toBe(false);
    expect(await ledgerExists(h)).toEqual([{ value: null }]);
  } finally {
    await h.close();
  }
});

it("refuses partial workflow objects on the canonical pre-workflow prefix", async () => {
  const h = await freshMigrationDb();
  try {
    await installPrefix(h, 86);
    await h.db.execute(sql`CREATE TABLE public.workflow_steps(id uuid)`);
    const before = await ledger(h);
    expect(await applyMigrations(h.db)).toEqual({
      ok: false,
      error: "refusing pre-existing workflow objects before the canonical workflow migration",
    });
    expect(await ledger(h)).toEqual(before);
    expect(
      (await h.db.execute(sql`SELECT to_regclass('public.workflow_runs') AS value`)).rows,
    ).toEqual([{ value: null }]);
  } finally {
    await h.close();
  }
});

it("checks disabled workflow guards even on a completed no-op history", async () => {
  const h = await makeTestDb();
  try {
    await h.db.execute(
      sql`ALTER TABLE public.workflow_versions DISABLE TRIGGER workflow_versions_immutable`,
    );
    const before = await ledger(h);
    expect(await applyMigrations(h.db)).toEqual({
      ok: false,
      error: "canonical workflow integrity checks failed",
    });
    expect(await ledger(h)).toEqual(before);
  } finally {
    await h.close();
  }
});

it.each(["condition", "columns"] as const)(
  "refuses a narrowed immutable trigger (%s) on a no-op history",
  async (narrowing) => {
    const h = await makeTestDb();
    try {
      await h.db.execute(sql`DROP TRIGGER workflow_versions_immutable ON public.workflow_versions`);
      if (narrowing === "condition")
        await h.db.execute(
          sql`CREATE TRIGGER workflow_versions_immutable BEFORE UPDATE OR DELETE ON public.workflow_versions FOR EACH ROW WHEN (false) EXECUTE FUNCTION public.workflow_version_immutable()`,
        );
      else
        await h.db.execute(
          sql`CREATE TRIGGER workflow_versions_immutable BEFORE UPDATE OF name OR DELETE ON public.workflow_versions FOR EACH ROW EXECUTE FUNCTION public.workflow_version_immutable()`,
        );
      const before = await ledger(h);
      expect(await applyMigrations(h.db)).toEqual({
        ok: false,
        error: "canonical workflow integrity checks failed",
      });
      expect(await ledger(h)).toEqual(before);
    } finally {
      await h.close();
    }
  },
);

it("rolls back fresh metadata as well as pending schema when a later statement fails", async () => {
  const h = await freshMigrationDb();
  const fixture = await migrationFolder(undefined, false, true);
  try {
    expect((await applyMigrations(h.db, undefined, fixture.folder)).ok).toBe(false);
    expect(await ledgerExists(h)).toEqual([{ value: null }]);
    expect(
      (
        await h.db.execute(
          sql`SELECT to_regclass('public.users') AS value, to_regclass('public.migration_rollback_probe') AS probe`,
        )
      ).rows,
    ).toEqual([{ value: null, probe: null }]);
  } finally {
    await fixture.dispose();
    await h.close();
  }
});

it("preserves cancellation before touching migration metadata", async () => {
  const h = await freshMigrationDb();
  try {
    await expect(applyMigrations(h.db, AbortSignal.abort())).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(await ledgerExists(h)).toEqual([{ value: null }]);
  } finally {
    await h.close();
  }
});
