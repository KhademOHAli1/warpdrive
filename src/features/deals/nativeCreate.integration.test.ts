import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, test } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { authUsers, deals, permissionSets, pipelines, sessions } from "@/db/schema";
import { makeTestDb } from "@/test/db";
import { createNativeDeal } from "./nativeCreate";
import { creationEffects, creationFixture, creationSignal } from "./nativeCreate.test-helpers";

test.each([false, true])(
  "one completed receipt and exact numeric value survive same-intent replay (modern=%s)",
  async (modern) => {
    const h = await makeTestDb();
    try {
      const f = await creationFixture(h, modern);
      const first = await createNativeDeal(h.db, f.who, f.input, creationSignal());
      expect(first).toMatchObject({ ok: true, replayed: false });
      if (!first.ok || first.deal === null)
        throw new AppError(ERROR_IDS.DB_INVARIANT, "Expected an authorized created deal");
      const row = (
        await h.pool.query<{ value: string; updated_at: Date; write_version: string }>(
          "SELECT value::text AS value, updated_at, write_version FROM deals WHERE id=$1",
          [first.deal.id],
        )
      ).rows[0];
      if (row === undefined)
        throw new AppError(ERROR_IDS.DB_INVARIANT, "Expected the persisted created deal");
      expect(row.value).toBe("99999999999999.9999");
      expect(row.write_version).toBe(first.deal.writeVersion);
      expect(row.updated_at.toISOString()).toBe(first.deal.updatedAt);
      const replay = await createNativeDeal(h.db, f.who, f.input, creationSignal());
      expect(replay).toEqual({ ...first, replayed: true });
      expect(await creationEffects(h, f)).toEqual({
        deals: 1,
        receipts: 1,
        links: 1,
        labels: 1,
        channel: 1,
      });
    } finally {
      await h.close();
    }
  },
);

test("concurrent equal operations serialize to one deal, label/effect set and receipt", async () => {
  const h = await makeTestDb();
  try {
    const f = await creationFixture(h);
    const result = await Promise.all([
      createNativeDeal(h.db, f.who, f.input, creationSignal()),
      createNativeDeal(h.db, f.who, f.input, creationSignal()),
    ]);
    expect(result.every((value) => value.ok)).toBe(true);
    expect(
      new Set(result.flatMap((value) => (value.ok && value.deal !== null ? [value.deal.id] : [])))
        .size,
    ).toBe(1);
    expect(result.filter((value) => value.ok && value.replayed)).toHaveLength(1);
    expect(await creationEffects(h, f)).toEqual({
      deals: 1,
      receipts: 1,
      links: 1,
      labels: 1,
      channel: 1,
    });
  } finally {
    await h.close();
  }
});

test("same key rejects changed intent; a different key deliberately creates another deal", async () => {
  const h = await makeTestDb();
  try {
    const f = await creationFixture(h);
    expect((await createNativeDeal(h.db, f.who, f.input, creationSignal())).ok).toBe(true);
    expect(
      await createNativeDeal(
        h.db,
        f.who,
        { ...f.input, deal: { ...f.input.deal, value: "1.0001" } },
        creationSignal(),
      ),
    ).toMatchObject({ ok: false, error: { id: "E_DEAL_019" } });
    expect(
      (
        await createNativeDeal(
          h.db,
          f.who,
          { ...f.input, creationOperationId: randomUUID() },
          creationSignal(),
        )
      ).ok,
    ).toBe(true);
    expect(await creationEffects(h, f)).toEqual({
      deals: 2,
      receipts: 2,
      links: 2,
      labels: 1,
      channel: 2,
    });
  } finally {
    await h.close();
  }
});

test("an A-owned frozen request cannot become a B-owned operation after a credential switch", async () => {
  const h = await makeTestDb();
  try {
    const a = await creationFixture(h),
      b = await creationFixture(h);
    expect(await createNativeDeal(h.db, b.who, a.input, creationSignal())).toMatchObject({
      ok: false,
      error: { id: "E_AUTH_003" },
    });
    expect(await creationEffects(h, a)).toEqual({
      deals: 0,
      receipts: 0,
      links: 0,
      labels: 0,
      channel: 0,
    });
    expect(await creationEffects(h, b)).toEqual({
      deals: 0,
      receipts: 0,
      links: 0,
      labels: 0,
      channel: 0,
    });
  } finally {
    await h.close();
  }
});

test("committed replay ignores later create permission/default/custom-definition changes", async () => {
  const h = await makeTestDb();
  try {
    const f = await creationFixture(h);
    const first = await createNativeDeal(h.db, f.who, f.input, creationSignal());
    expect(first.ok).toBe(true);
    await h.db
      .update(permissionSets)
      .set({ flags: {} })
      .where(eq(permissionSets.id, f.permissionSetId));
    await h.pool.query(
      "UPDATE settings SET base_currency='EUR'; INSERT INTO custom_field_defs(target_entity,type,name,key,is_required,is_important) VALUES('deal','text','Later requirement','later_requirement',true,true)",
    );
    expect(await createNativeDeal(h.db, f.who, f.input, creationSignal())).toEqual({
      ...first,
      replayed: true,
    });
    expect(await creationEffects(h, f)).toEqual({
      deals: 1,
      receipts: 1,
      links: 1,
      labels: 1,
      channel: 1,
    });
  } finally {
    await h.close();
  }
});

test.each(["soft_delete", "archive_pipeline", "hard_delete", "hide_owner"])(
  "completed %s outcome is unavailable and never recreated",
  async (kind) => {
    const h = await makeTestDb();
    try {
      const f = await creationFixture(h);
      const first = await createNativeDeal(h.db, f.who, f.input, creationSignal());
      expect(first.ok).toBe(true);
      if (!first.ok || first.deal === null)
        throw new AppError(ERROR_IDS.DB_INVARIANT, "Expected an authorized created deal");
      if (kind === "soft_delete")
        await h.db.update(deals).set({ deletedAt: new Date() }).where(eq(deals.id, first.deal.id));
      if (kind === "archive_pipeline")
        await h.db
          .update(pipelines)
          .set({ isArchived: true })
          .where(eq(pipelines.id, f.pipeline.pipeline.id));
      if (kind === "hard_delete") await h.db.delete(deals).where(eq(deals.id, first.deal.id));
      if (kind === "hide_owner") {
        const other = await creationFixture(h);
        await h.db
          .update(deals)
          .set({ ownerId: other.user.id, visibilityLevel: "owner", visibleToUserIds: [] })
          .where(eq(deals.id, first.deal.id));
      }
      expect(await createNativeDeal(h.db, f.who, f.input, creationSignal())).toEqual({
        ok: true,
        deal: null,
        replayed: true,
      });
      const stored = (
        await h.pool.query<{ deal_id: string | null }>(
          "SELECT deal_id FROM deal_create_operations WHERE actor_id=$1 AND operation_id=$2",
          [f.user.id, f.input.creationOperationId],
        )
      ).rows;
      expect(stored).toHaveLength(1);
      if (kind === "hard_delete") expect(stored[0]?.deal_id).toBeNull();
      expect((await creationEffects(h, f))?.receipts).toBe(1);
      expect((await creationEffects(h, f))?.channel).toBe(1);
    } finally {
      await h.close();
    }
  },
);

test.each(["revoked", "expired", "missing_identity"])(
  "current modern %s session cannot resolve a committed receipt",
  async (kind) => {
    const h = await makeTestDb();
    try {
      const f = await creationFixture(h, true);
      expect((await createNativeDeal(h.db, f.who, f.input, creationSignal())).ok).toBe(true);
      if (kind === "revoked")
        await h.db
          .update(sessions)
          .set({ revokedAt: new Date() })
          .where(eq(sessions.id, f.who.sessionId));
      if (kind === "expired")
        await h.db
          .update(sessions)
          .set({ expiresAt: new Date(0) })
          .where(eq(sessions.id, f.who.sessionId));
      if (kind === "missing_identity")
        await h.db.delete(authUsers).where(eq(authUsers.id, f.user.id));
      expect(await createNativeDeal(h.db, f.who, f.input, creationSignal())).toMatchObject({
        ok: false,
        error: { id: "E_AUTH_003" },
      });
      expect(await creationEffects(h, f)).toEqual({
        deals: 1,
        receipts: 1,
        links: 1,
        labels: 1,
        channel: 1,
      });
    } finally {
      await h.close();
    }
  },
);

test("final session denial after local writes rolls back deal, adopted label, event, receipt and trigger effect", async () => {
  const h = await makeTestDb();
  try {
    const f = await creationFixture(h);
    await h.pool.query(
      `CREATE FUNCTION native_probe_revoke() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN UPDATE sessions SET revoked_at=clock_timestamp() WHERE id='${f.who.sessionId}'; RETURN NEW; END $$; CREATE TRIGGER native_probe_revoke AFTER INSERT ON deal_create_operations FOR EACH ROW EXECUTE FUNCTION native_probe_revoke()`,
    );
    expect(await createNativeDeal(h.db, f.who, f.input, creationSignal())).toEqual({
      ok: false,
      error: { id: "E_AUTH_003" },
      outcome: "not_created",
    });
    expect(await creationEffects(h, f)).toEqual({
      deals: 0,
      receipts: 0,
      links: 0,
      labels: 0,
      channel: 0,
    });
    expect(
      (
        await h.pool.query<{ revoked_at: Date | null }>(
          "SELECT revoked_at FROM sessions WHERE id=$1",
          [f.who.sessionId],
        )
      ).rows[0]?.revoked_at,
    ).toBeNull();
  } finally {
    await h.close();
  }
});

test("receipt-storage exception after local effects remains uncertain and leaves no committed effect", async () => {
  const h = await makeTestDb();
  try {
    const f = await creationFixture(h);
    await h.pool.query(
      "CREATE FUNCTION native_probe_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'native qualification rollback'; END $$; CREATE TRIGGER native_probe_fail BEFORE INSERT ON deal_create_operations FOR EACH ROW EXECUTE FUNCTION native_probe_fail()",
    );
    await expect(createNativeDeal(h.db, f.who, f.input, creationSignal())).rejects.toThrow();
    expect(await creationEffects(h, f)).toEqual({
      deals: 0,
      receipts: 0,
      links: 0,
      labels: 0,
      channel: 0,
    });
  } finally {
    await h.close();
  }
});
