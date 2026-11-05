import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { describe, expect, test } from "vitest";
import type { PermSetUser } from "@/features/permissions/effective";
import { calculatePeriodForecast } from "@/features/stats/periodForecast";
import { makeTestDb, type TestDb } from "@/test/db";
import {
  EXACT_LEGACY_VALUE,
  type HistoryCaptureFixture,
  prepareHistoryCapture,
} from "./capture.test-helpers";

import {
  type ForecastCommitExpectation,
  qualifyForecastCommit,
} from "./forecastCommitQualification";

const correctionReason = "Re-observed the deal and updated the model assumption";

async function withCustody(run: (h: TestDb, fixture: HistoryCaptureFixture) => Promise<void>) {
  const h = await makeTestDb();
  try {
    const fixture = await prepareHistoryCapture(h);
    const proposal = await readFile(
      new URL("../../../../docs/analytics/forecast-custody-proposal.sql", import.meta.url),
      "utf8",
    );
    const client = await h.pool.connect();
    try {
      await client.query("SET statement_timeout='5000ms'; SET lock_timeout='2000ms'");
      await client.query(proposal);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      try {
        await client.query("RESET statement_timeout; RESET lock_timeout");
      } finally {
        client.release();
      }
    }
    await run(h, fixture);
  } finally {
    await h.close();
  }
}

interface Source {
  activationId: string;
  incarnationId: string;
  tipOrdinal: string;
  value: string;
  expectedCloseDate: string | null;
  cut: string;
  snapshot: string;
  anchorDay: string;
  from: string;
  toExclusive: string;
  fromDate: string;
  toDate: string;
}

interface Options {
  requestKey?: string;
  supersedes?: string;
  snapshotOverride?: string;
  corruptTip?: boolean;
  targetAlreadyStarted?: boolean;
  targetNonMidnight?: boolean;
  anchorDay?: string;
  beforeCommit?: (expected: ForecastCommitExpectation) => Promise<void>;
}

// This fixture exercises private storage only. The synthetic scope and assumptions
// stand in for facts an authenticated native adapter would have to prove.
async function save(h: TestDb, f: HistoryCaptureFixture, options: Options = {}) {
  const client = await h.pool.connect();
  const id = randomUUID();
  const requestKey = options.requestKey ?? randomUUID();
  const supersedes = options.supersedes ?? null;
  const reason = supersedes === null ? null : correctionReason;
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    await client.query("SET LOCAL statement_timeout='5000ms'; SET LOCAL lock_timeout='2000ms'");
    const { rows } = await client.query<Source>(
      `WITH wall AS MATERIALIZED (
        SELECT pg_catalog.clock_timestamp() AS cut, pg_catalog.pg_current_snapshot() AS snapshot
      ), frame AS (
        SELECT cut, snapshot, coalesce($3::date, (cut AT TIME ZONE 'UTC')::date) AS day FROM wall
      )
      SELECT h.activation_id::text AS "activationId", h.incarnation_id::text AS "incarnationId",
        h.last_event_ordinal::text AS "tipOrdinal", d.value::text AS value,
        d.expected_close_date::text AS "expectedCloseDate", snapshot::text AS snapshot,
        public.analytics_history_utc(cut) AS cut, day::text AS "anchorDay",
        public.analytics_history_utc(((day + $2::integer)::timestamp +
          CASE WHEN $4::boolean THEN interval '1 hour' ELSE interval '0 hours' END)
          AT TIME ZONE 'UTC') AS "from",
        public.analytics_history_utc((day + 3)::timestamp AT TIME ZONE 'UTC') AS "toExclusive",
        (day + $2::integer)::text AS "fromDate", (day + 3)::text AS "toDate"
      FROM frame CROSS JOIN public.deals d
      JOIN public.analytics_history_heads h ON h.entity_kind='deal' AND h.entity_id=d.id
      WHERE d.id=$1::uuid`,
      [
        f.dealId,
        options.targetAlreadyStarted === true ? -1 : 2,
        options.anchorDay ?? null,
        options.targetNonMidnight === true,
      ],
    );
    const source = rows[0];
    if (source === undefined) throw new Error("Expected one captured fixture deal");

    const target = {
      from: source.from,
      toExclusive: source.toExclusive,
      timeZone: "UTC",
      calendar: "gregory",
    } as const;
    const scope = { pipelineId: f.pipelineId, ownerId: f.userId };
    const reportDefinition = { id: "saved-period-forecast", version: 1 };
    const modelVersion = "fixture-1";
    const modelDefinition = { id: "fixture-assumptions", version: modelVersion };
    const roster = [
      {
        dealId: f.dealId,
        incarnationId: source.incarnationId,
        tipOrdinal: options.corruptTip === true ? "9223372036854775807" : source.tipOrdinal,
        status: "open",
        currency: "EUR",
        value: source.value,
        expectedCloseDate: source.expectedCloseDate,
      },
    ];
    const evidence = {
      kind: "manual",
      sourceId: "fixture-assumption",
      version: "1",
      observedAt: source.cut,
    } as const;
    const scenario = {
      pWin: { probability: "1", evidence },
      pCloseInPeriodGivenWin: { probability: "1", evidence, target },
    };
    const result = calculatePeriodForecast({
      currency: "EUR",
      target,
      cutoffObservedAt: source.cut,
      deals: [
        {
          dealId: f.dealId,
          incarnationId: source.incarnationId,
          status: "open",
          currency: "EUR",
          value: source.value,
          expectedCloseDate: source.expectedCloseDate,
          scenarios: { conservative: scenario, base: scenario, upside: scenario },
        },
      ],
    });
    if (!result.ok) throw new Error("Expected exact fixture forecast");
    const request = {
      schemaVersion: 1,
      requestKey,
      target,
      scope,
      currency: "EUR",
      reportDefinition,
      modelDefinition,
      modelVersion,
      supersedesForecastId: supersedes,
      correctionReason: reason,
    };
    const requestBytes = JSON.stringify(request);
    const payloadBytes = JSON.stringify({
      schemaVersion: 1,
      request,
      activationId: source.activationId,
      createdBy: f.userId,
      nativeSnapshot: options.snapshotOverride ?? source.snapshot,
      roster,
      result,
    });

    const inserted = await client.query<{ writerXid: string; insertedAt: string }>(
      `INSERT INTO public.analytics_report_snapshots (
        id, activation_id, kind, definition_version, report_definition, model_version,
        model_definition, scope, currency, time_zone, calendar, cutoff_observed_at,
        transaction_snapshot, target_from, target_to_exclusive, records, created_by,
        forecast_request_key, forecast_request_bytes, forecast_payload_bytes,
        forecast_target_start, forecast_target_end, supersedes_forecast_id, forecast_correction_reason
      ) VALUES (
        $1::uuid, $2::uuid, 'forecast', 1, $3::jsonb, $4,
        $5::jsonb, $6::jsonb, 'EUR', 'UTC', 'gregory', $7::timestamptz,
        $8::pg_catalog.pg_snapshot, $9::date, $10::date, $11::jsonb, $12::uuid,
        $13::uuid, $14, $15, $16::timestamptz, $17::timestamptz, $18::uuid, $19
      ) RETURNING forecast_writer_xid::text AS "writerXid",
        public.analytics_history_utc(created_at) AS "insertedAt"`,
      [
        id,
        source.activationId,
        JSON.stringify(reportDefinition),
        modelVersion,
        JSON.stringify(modelDefinition),
        JSON.stringify(scope),
        source.cut,
        options.snapshotOverride ?? source.snapshot,
        source.fromDate,
        source.toDate,
        JSON.stringify(roster),
        f.userId,
        requestKey,
        requestBytes,
        payloadBytes,
        source.from,
        source.toExclusive,
        supersedes,
        reason,
      ],
    );
    const receipt = inserted.rows[0];
    if (receipt === undefined) throw new Error("Expected a forecast insert receipt");
    const expected: ForecastCommitExpectation = {
      snapshotId: id,
      activationId: source.activationId,
      requestKey,
      currency: "EUR",
      writerXid: receipt.writerXid,
      captureSnapshot: options.snapshotOverride ?? source.snapshot,
      predictionCutoff: source.cut,
      insertedAt: receipt.insertedAt,
      requestSha256: digest("warpdrive-forecast-request-v1", requestBytes),
      payloadSha256: digest("warpdrive-forecast-payload-v1", payloadBytes),
      target: { ...target, fromDate: source.fromDate, toExclusiveDate: source.toDate },
    };
    await options.beforeCommit?.(expected);
    await client.query("COMMIT");
    return {
      id,
      expected,
      requestKey,
      requestBytes,
      payloadBytes,
      snapshot: source.snapshot,
      anchorDay: source.anchorDay,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function stored(h: TestDb, id: string) {
  const { rows } = await h.pool.query<{
    requestBytes: string;
    requestDigest: string;
    payloadBytes: string;
    payloadDigest: string;
    supersedes: string | null;
    value: string;
    baseForecast: string;
    insertedBeforeTarget: boolean;
  }>(
    `SELECT forecast_request_bytes AS "requestBytes", forecast_payload_bytes AS "payloadBytes",
      pg_catalog.encode(forecast_request_sha256, 'hex') AS "requestDigest",
      pg_catalog.encode(forecast_payload_sha256, 'hex') AS "payloadDigest",
      supersedes_forecast_id::text AS supersedes, records #>> '{0,value}' AS value,
      forecast_payload_bytes::jsonb #>> '{result,scenarios,base,expectedWonValue,knownTotal}' AS "baseForecast",
      created_at < forecast_target_start AND cutoff_observed_at <= created_at AS "insertedBeforeTarget"
    FROM public.analytics_report_snapshots WHERE id=$1::uuid`,
    [id],
  );
  const row = rows[0];
  if (row === undefined) throw new Error("Expected saved forecast");
  return row;
}

function digest(domain: string, bytes: string): string {
  return createHash("sha256").update(`${domain}\n${bytes}`, "utf8").digest("hex");
}

function fixtureCreator(id: string): PermSetUser {
  return { id, type: "regular", isActive: true, groupIds: new Set(), flags: new Set() };
}

function observerPool(h: TestDb): Pool {
  return new Pool({
    connectionString: h.url,
    max: 1,
    connectionTimeoutMillis: 2_000,
    query_timeout: 6_000,
  });
}

const signal = () => AbortSignal.timeout(10_000);
const noProof = { state: "unavailable", reason: "no-qualifying-receipt" };

describe("private forecast custody proposal", () => {
  test("observes an independently committed receipt for only the active creator and exact expectation", async () => {
    await withCustody(async (h, f) => {
      const reader = observerPool(h);
      const actor = fixtureCreator(f.userId);
      try {
        const original = await save(h, f, {
          beforeCommit: async (expected) => {
            expect(await qualifyForecastCommit(reader, actor, expected, signal())).toEqual(noProof);
          },
        });
        const result = await qualifyForecastCommit(reader, actor, original.expected, signal());
        expect(result).toMatchObject({
          state: "confirmed",
          proof: {
            ...original.expected,
            creatorId: f.userId,
            basis: "independent-native-visibility-before-target",
          },
        });
        if (result.state !== "confirmed") throw new Error("Expected committed visibility");
        expect(result.proof.confirmedAt >= original.expected.insertedAt).toBe(true);
        expect(result.proof.confirmedAt < original.expected.target.from).toBe(true);

        const other = randomUUID();
        await h.pool.query(
          "INSERT INTO public.users(id,email,name) VALUES($1,$2,'Another creator')",
          [other, `other-${other}@example.test`],
        );
        expect(
          await qualifyForecastCommit(reader, fixtureCreator(other), original.expected, signal()),
        ).toEqual(noProof);
        expect(
          await qualifyForecastCommit(
            reader,
            actor,
            {
              ...original.expected,
              target: {
                ...original.expected.target,
                from: original.expected.target.from.replace(".000000Z", ".000001Z"),
              },
            },
            signal(),
          ),
        ).toEqual(noProof);
        expect(
          await qualifyForecastCommit(
            reader,
            actor,
            {
              ...original.expected,
              payloadSha256: "0".repeat(64),
            },
            signal(),
          ),
        ).toEqual(noProof);

        await h.pool.query("UPDATE public.users SET is_active=false WHERE id=$1", [f.userId]);
        expect(await qualifyForecastCommit(reader, actor, original.expected, signal())).toEqual(
          noProof,
        );
      } finally {
        await reader.end();
      }
    });
  });

  test("rejects a dirty checkout and later replacement of the forecast tuple", async () => {
    await withCustody(async (h, f) => {
      const original = await save(h, f);
      const actor = fixtureCreator(f.userId);
      const reader = observerPool(h);
      try {
        const dirty = await reader.connect();
        try {
          await dirty.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
        } finally {
          dirty.release();
        }
        expect(await qualifyForecastCommit(reader, actor, original.expected, signal())).toEqual({
          state: "unavailable",
          reason: "session-unavailable",
        });
        expect(
          await qualifyForecastCommit(reader, actor, original.expected, signal()),
        ).toMatchObject({ state: "confirmed" });

        // Disposable owner-only corruption control. Keep all bytes and stamps unchanged
        // but create a different tuple, then restore the guard before reading.
        await h.pool.query(
          "ALTER TABLE public.analytics_report_snapshots DISABLE TRIGGER analytics_snapshots_mutation_guard",
        );
        try {
          await h.pool.query(
            "UPDATE public.analytics_report_snapshots SET created_at=created_at WHERE id=$1",
            [original.id],
          );
        } finally {
          await h.pool.query(
            "ALTER TABLE public.analytics_report_snapshots ENABLE ALWAYS TRIGGER analytics_snapshots_mutation_guard",
          );
        }
        const actual = await h.pool.query<{ originalTuple: boolean }>(
          'SELECT xmin=forecast_writer_xid::pg_catalog.xid AS "originalTuple" FROM public.analytics_report_snapshots WHERE id=$1',
          [original.id],
        );
        expect(actual.rows).toEqual([{ originalTuple: false }]);
        expect(await qualifyForecastCommit(reader, actor, original.expected, signal())).toEqual(
          noProof,
        );
      } finally {
        await reader.end();
      }
    });
  });

  test("preserves exact bytes, prediction and roster across source edits and a linked correction", async () => {
    await withCustody(async (h, f) => {
      const original = await save(h, f);
      const prior = await stored(h, original.id);
      expect(prior).toEqual({
        requestBytes: original.requestBytes,
        requestDigest: digest("warpdrive-forecast-request-v1", original.requestBytes),
        payloadBytes: original.payloadBytes,
        payloadDigest: digest("warpdrive-forecast-payload-v1", original.payloadBytes),
        supersedes: null,
        value: EXACT_LEGACY_VALUE,
        baseForecast: EXACT_LEGACY_VALUE,
        insertedBeforeTarget: true,
      });

      await h.pool.query("UPDATE public.deals SET value='10.1234' WHERE id=$1", [f.dealId]);
      const correction = await save(h, f, {
        supersedes: original.id,
        anchorDay: original.anchorDay,
      });
      expect(await stored(h, correction.id)).toMatchObject({
        supersedes: original.id,
        value: "10.1234",
        baseForecast: "10.1234",
        insertedBeforeTarget: true,
      });
      expect(await stored(h, original.id)).toEqual(prior);
      await expect(
        save(h, f, { supersedes: original.id, anchorDay: original.anchorDay }),
      ).rejects.toMatchObject({
        code: "23505",
        constraint: "analytics_forecast_one_successor_idx",
      });
      await expect(
        save(h, f, { requestKey: original.requestKey, anchorDay: original.anchorDay }),
      ).rejects.toMatchObject({
        code: "23505",
        constraint: "analytics_forecast_request_once_idx",
      });
      await expect(
        h.pool.query(
          "UPDATE public.analytics_report_snapshots SET records='[]'::jsonb WHERE id=$1",
          [original.id],
        ),
      ).rejects.toMatchObject({ code: "55000" });
    });
  });

  test("rejects a stale native witness, forged roster tip and already started target", async () => {
    await withCustody(async (h, f) => {
      const original = await save(h, f);
      await h.pool.query("UPDATE public.deals SET value='20.5678' WHERE id=$1", [f.dealId]);
      await expect(save(h, f, { snapshotOverride: original.snapshot })).rejects.toMatchObject({
        code: "55000",
        message: "analytics snapshot witness does not match the current observation",
      });
      await expect(save(h, f, { corruptTip: true })).rejects.toMatchObject({
        code: "23514",
        message: "forecast roster disagrees with the captured deal tip",
      });
      await expect(save(h, f, { targetAlreadyStarted: true })).rejects.toMatchObject({
        code: "23514",
        message: "forecast cutoff and save must precede a valid target",
      });
      await expect(save(h, f, { targetNonMidnight: true })).rejects.toMatchObject({
        code: "23514",
        message: "forecast target dates disagree with the resolved instants",
      });
      const saved = await h.pool.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM public.analytics_report_snapshots WHERE kind='forecast'",
      );
      expect(saved.rows).toEqual([{ count: 1 }]);
    });
  });

  test("rejects an inactive creator even with exact source evidence", async () => {
    await withCustody(async (h, f) => {
      await h.pool.query("UPDATE public.users SET is_active=false WHERE id=$1", [f.userId]);
      await expect(save(h, f)).rejects.toMatchObject({
        code: "42501",
        message: "forecast creator unavailable",
      });
    });
  });
});
