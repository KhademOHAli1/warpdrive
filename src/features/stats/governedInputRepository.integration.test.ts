import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { makeTestDb, type TestDb } from "@/test/db";
import { analyticsInputBatch } from "./analyticsInputContracts";
import { type AuthenticatedGovernedInput, writeGovernedInput } from "./governedInputRepository";

const producer = "fixture-commerce-source";
const principalRef = "fixture-adapter";
const registrationRef = "fixture-registration";
const signal = () => AbortSignal.timeout(10_000);

function commerce(eventId: string, sourceRecordId: string, supersedes?: string) {
  return {
    kind: "commerce",
    event: "purchase",
    orderId: sourceRecordId,
    identity: { purchaseId: sourceRecordId },
    originalMoney: { amount: "123.4567", currency: "EUR", unit: "currency-major" },
    quantity: 1,
    quantityUnit: "item",
    provenance: {
      producer,
      sourceRecordId,
      eventId,
      revision: supersedes === undefined ? 1 : 2,
      capturedAt: "2026-05-01T12:30:00.123456789+02:00",
      effectiveAt: "2026-05-01T11:30:00.123456789+02:00",
      calendar: "gregory",
      storage: "gregorian-iso8601",
      timeZone: "Europe/Berlin",
      ...(supersedes === undefined
        ? {}
        : { supersedes: { eventId: supersedes, revision: 1 }, correctionReason: "source repair" }),
    },
  };
}

function delivery(
  batchId: string,
  events: ReturnType<typeof commerce>[],
): AuthenticatedGovernedInput {
  // The disposable fixture supplies synthetic proof. The production brand belongs
  // to the actual authentication and link-policy adapter.
  return {
    authority: {
      producer,
      registrationRef,
      authenticationRef: "fixture-authentication",
      principal: { kind: "service-adapter", principalRef },
    },
    batch: analyticsInputBatch.parse({ contractVersion: 1, batchId, events }),
  } as AuthenticatedGovernedInput;
}

async function withCustody(run: (h: TestDb) => Promise<void>) {
  const h = await makeTestDb();
  try {
    const proposal = await readFile(
      resolve("docs/analytics/governed-source-storage-proposal.sql"),
      "utf8",
    );
    await h.pool.query(proposal);
    await h.pool.query(
      "INSERT INTO public.analytics_input_producers(producer,registration_ref,enabled) VALUES($1,$2,true)",
      [producer, registrationRef],
    );
    await h.pool.query(
      `INSERT INTO public.analytics_input_grants(
        producer,principal_kind,principal_ref,event_family,policy_version
      ) VALUES($1,'service-adapter',$2,'commerce','fixture-policy-v1')`,
      [producer, principalRef],
    );
    await run(h);
  } finally {
    await h.close();
  }
}

async function counts(h: TestDb) {
  const { rows } = await h.pool.query<{ events: number; admissions: number; lines: number }>(`
    SELECT (SELECT count(*)::int FROM public.analytics_input_events) AS events,
      (SELECT count(*)::int FROM public.analytics_input_admissions) AS admissions,
      (SELECT count(*)::int FROM public.analytics_input_admission_items) AS lines
  `);
  return rows[0];
}

describe("governed analytics input custody", () => {
  test("commits out-of-order corrections and preserves exact bytes and original receipt on retry", async () => {
    await withCustody(async (h) => {
      const original = commerce("event-original", "purchase-one");
      const correction = commerce("event-correction", "purchase-one", "event-original");
      const first = await writeGovernedInput(
        h.pool,
        delivery("first", [correction, original]),
        signal(),
      );
      expect(first).toMatchObject({
        state: "committed",
        lines: [
          { inputIndex: 0, eventId: "event-correction", revision: 2, disposition: "appended" },
          { inputIndex: 1, eventId: "event-original", revision: 1, disposition: "appended" },
        ],
      });
      if (first.state !== "committed")
        throw new AppError(ERROR_IDS.DB_WRITE_FAILED, "Expected committed first receipt");
      const retry = await writeGovernedInput(h.pool, delivery("retry", [original]), signal());
      expect(retry).toMatchObject({
        state: "committed",
        lines: [
          { inputIndex: 0, fingerprint: first.lines[1]?.fingerprint, disposition: "exact-retry" },
        ],
      });
      const stored = await h.pool.query(
        `SELECT first_admission_id::text AS "firstAdmissionId", first_input_index AS "firstInputIndex",
          payload #>> '{originalMoney,amount}' AS amount,
          payload #>> '{provenance,capturedAt}' AS "capturedAt"
        FROM public.analytics_input_events WHERE producer=$1 AND event_id='event-original'`,
        [producer],
      );
      expect(stored.rows).toEqual([
        {
          firstAdmissionId: first.admissionId,
          firstInputIndex: 1,
          amount: "123.4567",
          capturedAt: "2026-05-01T12:30:00.123456789+02:00",
        },
      ]);
      expect(await counts(h)).toEqual({ events: 2, admissions: 2, lines: 3 });
    });
  });

  test("serializes competing corrections and refuses retry after configured grant revocation", async () => {
    await withCustody(async (h) => {
      const original = commerce("event-original", "purchase-one");
      expect(
        await writeGovernedInput(h.pool, delivery("first", [original]), signal()),
      ).toMatchObject({
        state: "committed",
      });
      const results = await Promise.all(
        ["event-left", "event-right"].map((id) =>
          writeGovernedInput(
            h.pool,
            delivery(id, [commerce(id, "purchase-one", "event-original")]),
            signal(),
          ),
        ),
      );
      expect(results).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ state: "committed" }),
          expect.objectContaining({
            state: "rejected",
            reason: "revision-key-conflict",
            inputIndex: 0,
          }),
        ]),
      );
      await h.pool.query(
        "UPDATE public.analytics_input_grants SET revoked_at=pg_catalog.clock_timestamp() WHERE producer=$1",
        [producer],
      );
      expect(await writeGovernedInput(h.pool, delivery("revoked", [original]), signal())).toEqual({
        state: "unavailable",
        reason: "authority-unavailable",
      });
      expect(await counts(h)).toEqual({ events: 2, admissions: 2, lines: 2 });
    });
  });

  test("a deferred database failure rolls back the event, header and lines together", async () => {
    await withCustody(async (h) => {
      await h.pool.query(`
        CREATE FUNCTION public.fixture_fail_admission_commit() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
          RAISE EXCEPTION 'fixture late failure' USING ERRCODE = '23514';
        END;
        $$;
        CREATE CONSTRAINT TRIGGER fixture_fail_admission_commit AFTER INSERT
        ON public.analytics_input_admissions DEFERRABLE INITIALLY DEFERRED
        FOR EACH ROW EXECUTE FUNCTION public.fixture_fail_admission_commit();
      `);
      const result = await writeGovernedInput(
        h.pool,
        delivery("fails-at-commit", [commerce("event-original", "purchase-one")]),
        signal(),
      );
      expect(result).toMatchObject({
        state: "unavailable",
        reason: "commit-unconfirmed",
        admissionId: expect.any(String),
      });
      expect(await counts(h)).toEqual({ events: 0, admissions: 0, lines: 0 });
    });
  });
});
