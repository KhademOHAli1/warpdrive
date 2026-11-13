import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createTRPCUntypedClient, httpBatchLink } from "@trpc/client";
import { and, eq, inArray, sql } from "drizzle-orm";
import { Pool } from "pg";
import superjson from "superjson";
import { env } from "@/config/env";
import type { Db } from "@/db/client";
import {
  auditEvents,
  deals,
  leads,
  newsletterExposureReceipts,
  newsletterLeadSources,
  newsletterPersonAddresses,
  persons,
  pipelines,
  savedFilters,
  stages,
  users,
} from "@/db/schema";
import { mintCsrfToken } from "@/features/auth/csrf";
import { setPreferences } from "@/features/identity/preferencesRepo";
import { addressDigest } from "@/features/newsletter/identity/authority";
import { prepareHistoryCapture } from "@/features/stats/history/capture.test-helpers";

export interface CoreMutationEngineFixture {
  readonly engineOrigin: string;
  readonly engineNonce: string;
}

interface EngineState {
  requests: number;
  revokes: number;
  exposureReads: number;
  unexpected: number;
}

export interface CoreHttpMutationFacts {
  deniedCommands: number;
  identityDeniedProcedureCount: 6;
  denialVariants: readonly string[];
  businessStateUnchangedOnDenial: true;
  engineUnchangedOnDenial: true;
  detachCommittedAndAudited: true;
  attributedLeadCreatedAndReplayed: true;
  forecastAvailableFromCapturedRoster: true;
  savedReportCreatedAndRemoved: true;
  engine: EngineState;
  ownedBusinessRowsRemoved: true;
  fullDatabaseDropRequired: true;
}

interface Options {
  db: Db;
  origin: string;
  adminCookie: string;
  adminId: string;
  engine: CoreMutationEngineFixture;
  setMissingCsrfFacts: (missing: boolean) => void;
  stage: (name: string) => void;
  passed: (name: string) => void;
}

interface Command {
  readonly path: string;
  readonly input: Record<string, unknown>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function object(value: unknown): Record<string, unknown> {
  assert(isObject(value));
  return value;
}

export function admitCoreMutationEngine(fixture: CoreMutationEngineFixture): void {
  const endpoint = new URL(fixture.engineOrigin);
  assert(
    endpoint.protocol === "http:" &&
      endpoint.hostname === "127.0.0.1" &&
      endpoint.port !== "" &&
      endpoint.username === "" &&
      endpoint.password === "" &&
      endpoint.pathname === "/" &&
      endpoint.search === "" &&
      endpoint.hash === "" &&
      endpoint.origin === env.NEWSLETTER_BASE_URL,
    "Only the supervisor's explicit owned Engine origin is admitted",
  );
  assert(/^[A-Za-z0-9_-]{32,128}$/u.test(fixture.engineNonce), "Owned Engine nonce required");
}

async function engineControl(
  fixture: CoreMutationEngineFixture,
  operation: "admit" | "configure" | "state",
  body?: unknown,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${fixture.engineOrigin}/__fixture/${operation}`, {
    method: operation === "configure" ? "POST" : "GET",
    headers: {
      "x-warpdrive-fixture-nonce": fixture.engineNonce,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "error",
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(response.status, 200, "Owned Engine control must succeed");
  assert(response.body !== null, "Owned Engine control response body required");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "",
    bytes = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) {
        text += decoder.decode();
        break;
      }
      bytes += next.value.byteLength;
      assert(bytes <= 8192, "Owned Engine control response exceeds its bound");
      text += decoder.decode(next.value, { stream: true });
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  return object(JSON.parse(text));
}

async function engineState(fixture: CoreMutationEngineFixture): Promise<EngineState> {
  const value = await engineControl(fixture, "state");
  for (const name of ["requests", "revokes", "exposureReads", "unexpected"])
    assert(Number.isSafeInteger(value[name]) && Number(value[name]) >= 0);
  return {
    requests: Number(value.requests),
    revokes: Number(value.revokes),
    exposureReads: Number(value.exposureReads),
    unexpected: Number(value.unexpected),
  };
}

async function businessSnapshot(db: Db): Promise<unknown> {
  const result = await db.execute<{ state: unknown }>(sql`
    SELECT jsonb_build_object(
      'persons',(SELECT jsonb_agg(t ORDER BY id) FROM persons t),
      'links',(SELECT jsonb_agg(t ORDER BY id) FROM newsletter_person_addresses t),
      'identityCommands',(SELECT jsonb_agg(t ORDER BY id) FROM newsletter_identity_commands t),
      'personEvents',(SELECT jsonb_agg(t ORDER BY id) FROM newsletter_person_events t),
      'leads',(SELECT jsonb_agg(t ORDER BY id) FROM leads t),
      'exposures',(SELECT jsonb_agg(t ORDER BY id) FROM newsletter_exposure_receipts t),
      'leadSources',(SELECT jsonb_agg(t ORDER BY lead_id) FROM newsletter_lead_sources t),
      'saved',(SELECT jsonb_agg(t ORDER BY id) FROM saved_filters t),
      'audit',(SELECT jsonb_agg(t ORDER BY id) FROM audit_events t),
      'deals',(SELECT jsonb_agg(t ORDER BY id) FROM deals t),
      'pipelines',(SELECT jsonb_agg(t ORDER BY id) FROM pipelines t),
      'stages',(SELECT jsonb_agg(t ORDER BY id) FROM stages t)
    ) AS state
  `);
  assert(result.rows[0] !== undefined, "Business snapshot must exist");
  return result.rows[0].state;
}

function errorCode(error: unknown): unknown {
  if (error === null || typeof error !== "object" || !("data" in error)) return undefined;
  const data = error.data;
  return data !== null && typeof data === "object" && "code" in data ? data.code : undefined;
}

function wireClient(origin: string, cookie: string, token: string, variant = "valid") {
  const headers = {
    cookie: variant === "missing-cookie-token" ? cookie : `${cookie}; wd_csrf=${token}`,
    origin:
      variant === "wrong-origin" ? "https://cross.example.test" : new URL(env.BASE_URL).origin,
    "sec-fetch-site": variant === "wrong-site" ? "cross-site" : "same-origin",
  };
  return createTRPCUntypedClient({
    links: [
      httpBatchLink({
        url: `${origin}/api/trpc`,
        transformer: superjson,
        headers,
        fetch: async (input, init) => {
          const response = await fetch(input, { ...init, signal: AbortSignal.timeout(5000) });
          assert(/^trpc;dur=\d+(?:\.\d+)?$/u.test(response.headers.get("server-timing") ?? ""));
          return response;
        },
      }),
    ],
  });
}

function csrfTokenForVariant(variant: string, token: string): string | null {
  if (variant === "missing-input-token") return null;
  return variant === "wrong-token" ? `${token}x` : token;
}

async function verifyDeniedCommands(options: Options, commands: Command[], token: string) {
  const { db, origin, adminCookie, engine, stage, passed, setMissingCsrfFacts } = options;
  const variants = [
    "missing-server-facts",
    "missing-cookie-token",
    "missing-input-token",
    "wrong-token",
    "wrong-origin",
    "wrong-site",
  ];
  let deniedCommands = 0;
  stage("mutation-csrf-denials-without-effects");
  for (const variant of variants) {
    const before = await businessSnapshot(db);
    const externalBefore = await engineState(engine);
    setMissingCsrfFacts(variant === "missing-server-facts");
    try {
      const client = wireClient(origin, adminCookie, token, variant);
      for (const command of commands) {
        await assert.rejects(
          client.mutation(command.path, {
            ...command.input,
            csrfToken: csrfTokenForVariant(variant, token),
          }),
          (error: unknown) => errorCode(error) === "FORBIDDEN",
        );
        deniedCommands += 1;
      }
    } finally {
      setMissingCsrfFacts(false);
    }
    assert.deepEqual(
      await businessSnapshot(db),
      before,
      "Denied commands must preserve business rows",
    );
    assert.deepEqual(
      await engineState(engine),
      externalBefore,
      "Denied commands must not reach Engine",
    );
  }
  passed("mutation-csrf-denials-without-effects");
  return { deniedCommands, variants };
}

export async function runCoreHttpMutationChecks(options: Options): Promise<CoreHttpMutationFacts> {
  const { db, origin, adminCookie, adminId, engine, stage, passed, setMissingCsrfFacts } = options;
  admitCoreMutationEngine(engine);
  assert.deepEqual(await engineControl(engine, "admit"), {
    kind: "owned-core-mutation-engine",
    admitted: true,
  });
  assert("$client" in db && db.$client instanceof Pool, "Real bound PostgreSQL pool required");
  const pool = db.$client;
  const personId = randomUUID(),
    detachPersonId = randomUUID(),
    bindingId = randomUUID(),
    detachBindingId = randomUUID(),
    deliveryId = randomUUID(),
    grantId = randomUUID(),
    operationId = randomUUID(),
    detachOperationId = randomUUID(),
    absentSavedId = randomUUID();
  const token = mintCsrfToken();
  let savedId: string | undefined;
  let leadId: string | undefined;
  let history: Awaited<ReturnType<typeof prepareHistoryCapture>> | undefined;
  try {
    stage("mutation-fixture-setup");
    const address = `core-attribution-${bindingId}@example.test`;
    const detachAddress = `core-detach-${detachBindingId}@example.test`;
    await db.insert(persons).values([
      {
        id: personId,
        ownerId: adminId,
        name: "Owned attribution contact",
        visibilityLevel: "owner",
        emails: [{ value: address, label: "Work", primary: true }],
      },
      {
        id: detachPersonId,
        ownerId: adminId,
        name: "Owned detach contact",
        visibilityLevel: "owner",
        emails: [{ value: detachAddress, label: "Work", primary: true }],
      },
    ]);
    await db.insert(newsletterPersonAddresses).values([
      {
        id: bindingId,
        personId,
        actorId: adminId,
        addressDigest: addressDigest(address),
        evidenceReference: "CASE-2",
        expiresAt: new Date(Date.now() + 60_000),
        verifiedAt: new Date(Date.now() - 3000),
        subscriberId: 9,
        subscriberUuid: randomUUID(),
      },
      {
        id: detachBindingId,
        personId: detachPersonId,
        actorId: adminId,
        addressDigest: addressDigest(detachAddress),
        evidenceReference: "CASE-3",
        expiresAt: new Date(Date.now() + 60_000),
        verifiedAt: new Date(Date.now() - 3000),
        subscriberId: 10,
        subscriberUuid: randomUUID(),
      },
    ]);
    const time = await pool.query<{ now: string; from: string; to: string }>(`
      SELECT clock_timestamp()::text AS now,
        to_char((clock_timestamp() AT TIME ZONE 'UTC')::date + 2,'YYYY-MM-DD') AS "from",
        to_char((clock_timestamp() AT TIME ZONE 'UTC')::date + 5,'YYYY-MM-DD') AS "to"
    `);
    const dates = time.rows[0];
    assert(dates !== undefined);
    await engineControl(engine, "configure", {
      bindingId,
      deliveryId,
      grantId,
      detachBindingId,
      acceptedAt: new Date(dates.now).toISOString(),
    });
    history = await prepareHistoryCapture({
      db,
      pool,
      url: env.DATABASE_URL,
      close: () => Promise.resolve(),
    });
    await setPreferences(
      db,
      adminId,
      {
        timezone: "UTC",
        ui: { localePreferences: { locale: "en", calendar: "gregory", timeZone: "UTC" } },
      },
      AbortSignal.timeout(5000),
    );
    const definition = {
      version: 1,
      from: dates.from,
      to: dates.to,
      currency: "EUR",
      pipelineId: history.pipelineId,
      ownerScope: { kind: "all" },
    };
    const forecast = {
      policyVersion: 1,
      currency: "EUR",
      pipelineId: history.pipelineId,
      ownerScope: { kind: "all" },
      from: dates.from,
      to: dates.to,
      scenarios: {
        conservative: { pWin: "0", pCloseInPeriodGivenWin: "0" },
        base: { pWin: "0.5", pCloseInPeriodGivenWin: "0.5" },
        upside: { pWin: "1", pCloseInPeriodGivenWin: "1" },
      },
    };
    const identityBase = {
      personId: detachPersonId,
      operationId: detachOperationId,
      csrfToken: token,
    };
    const commands: Command[] = [
      {
        path: "newsletter.identity.beginProof",
        input: { ...identityBase, address: detachAddress, evidenceReference: "CASE-3" },
      },
      { path: "newsletter.identity.reconcile", input: { ...identityBase, claimId: randomUUID() } },
      {
        path: "newsletter.identity.invite",
        input: { ...identityBase, linkId: detachBindingId, listId: 3 },
      },
      { path: "newsletter.identity.detach", input: { ...identityBase, linkId: detachBindingId } },
      {
        path: "newsletter.identity.approveErasure",
        input: { ...identityBase, linkId: detachBindingId, privacyCaseId: randomUUID() },
      },
      {
        path: "newsletter.identity.erase",
        input: { ...identityBase, linkId: detachBindingId, privacyCaseId: randomUUID() },
      },
      {
        path: "newsletter.attribution.createLead",
        input: {
          personId,
          bindingId,
          deliveryId,
          operationId,
          title: "Owned attributed lead",
          csrfToken: token,
        },
      },
      { path: "stats.periodForecast", input: { scenario: forecast, csrfToken: token } },
      {
        path: "stats.savedPerformance.create",
        input: { name: "Owned HTTP report", definition, csrfToken: token },
      },
      { path: "stats.savedPerformance.remove", input: { id: absentSavedId, csrfToken: token } },
    ];
    const { deniedCommands, variants } = await verifyDeniedCommands(options, commands, token);
    const client = wireClient(origin, adminCookie, token);
    stage("mutation-identity-detach-remote-and-local");
    const detached = object(
      await client.mutation("newsletter.identity.detach", {
        ...identityBase,
        linkId: detachBindingId,
      }),
    );
    assert.equal(detached.state, "detached");
    const [link] = await db
      .select()
      .from(newsletterPersonAddresses)
      .where(eq(newsletterPersonAddresses.id, detachBindingId));
    assert(link?.detachedAt instanceof Date && link.detachedReason === "operator");
    const audits = await db
      .select({ id: auditEvents.id })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.actorId, adminId),
          eq(auditEvents.correlationId, detachOperationId),
          eq(auditEvents.action, "newsletter.identity.detach"),
        ),
      );
    assert.equal(audits.length, 1);
    assert.equal((await engineState(engine)).revokes, 1);
    passed("mutation-identity-detach-remote-and-local");
    stage("mutation-attributed-lead-durable-replay");
    const createInput = {
      personId,
      bindingId,
      deliveryId,
      operationId,
      title: "Owned attributed lead",
      csrfToken: token,
    };
    const created = object(await client.mutation("newsletter.attribution.createLead", createInput));
    assert(typeof created.id === "string");
    leadId = created.id;
    const externalAfterCreate = await engineState(engine);
    assert.deepEqual(
      await client.mutation("newsletter.attribution.createLead", createInput),
      created,
    );
    assert.deepEqual(
      await engineState(engine),
      externalAfterCreate,
      "Known receipt replay must not query Engine",
    );
    assert.equal((await db.select().from(leads).where(eq(leads.id, leadId))).length, 1);
    const sources = await db
      .select()
      .from(newsletterLeadSources)
      .where(eq(newsletterLeadSources.leadId, leadId));
    const source = sources[0];
    assert(sources.length === 1 && source !== undefined);
    assert(source.operationId === operationId && source.exposureId === deliveryId);
    assert.equal(
      (
        await db
          .select()
          .from(newsletterExposureReceipts)
          .where(eq(newsletterExposureReceipts.id, deliveryId))
      ).length,
      1,
    );
    passed("mutation-attributed-lead-durable-replay");
    stage("mutation-period-forecast-available-captured-roster");
    const projected = object(
      await client.mutation("stats.periodForecast", { scenario: forecast, csrfToken: token }),
    );
    assert.equal(projected.state, "available");
    assert.equal(projected.openDealCount, 1);
    assert.equal(projected.rosterBasis, "captured-current-open-deals");
    passed("mutation-period-forecast-available-captured-roster");
    stage("mutation-saved-report-create-remove");
    const saved = object(
      await client.mutation("stats.savedPerformance.create", {
        name: "Owned HTTP report",
        definition,
        csrfToken: token,
      }),
    );
    assert.equal(saved.state, "created");
    assert(typeof saved.id === "string");
    savedId = saved.id;
    assert.equal(
      (await db.select().from(savedFilters).where(eq(savedFilters.id, savedId))).length,
      1,
    );
    assert.deepEqual(
      await client.mutation("stats.savedPerformance.remove", { id: savedId, csrfToken: token }),
      { state: "removed" },
    );
    assert.equal(
      (await db.select().from(savedFilters).where(eq(savedFilters.id, savedId))).length,
      0,
    );
    passed("mutation-saved-report-create-remove");
    const external = await engineState(engine);
    assert(
      external.requests > 0 &&
        external.revokes === 1 &&
        external.exposureReads === 1 &&
        external.unexpected === 0,
    );
    return {
      deniedCommands,
      identityDeniedProcedureCount: 6,
      denialVariants: variants,
      businessStateUnchangedOnDenial: true,
      engineUnchangedOnDenial: true,
      detachCommittedAndAudited: true,
      attributedLeadCreatedAndReplayed: true,
      forecastAvailableFromCapturedRoster: true,
      savedReportCreatedAndRemoved: true,
      engine: external,
      ownedBusinessRowsRemoved: true,
      fullDatabaseDropRequired: true,
    };
  } finally {
    setMissingCsrfFacts(false);
    const cleanupFailures: unknown[] = [];
    const attempt = async (action: () => PromiseLike<unknown>) => {
      try {
        await action();
      } catch (error) {
        cleanupFailures.push(error);
      }
    };
    if (savedId !== undefined) {
      const id = savedId;
      await attempt(() => db.delete(savedFilters).where(eq(savedFilters.id, id)));
    }
    if (leadId !== undefined) {
      const id = leadId;
      await attempt(() => db.delete(leads).where(eq(leads.id, id)));
    }
    await attempt(() =>
      db.delete(newsletterExposureReceipts).where(eq(newsletterExposureReceipts.id, deliveryId)),
    );
    await attempt(() =>
      db
        .delete(newsletterPersonAddresses)
        .where(inArray(newsletterPersonAddresses.id, [bindingId, detachBindingId])),
    );
    await attempt(() => db.delete(persons).where(inArray(persons.id, [personId, detachPersonId])));
    await attempt(() =>
      db
        .delete(auditEvents)
        .where(
          and(eq(auditEvents.actorId, adminId), eq(auditEvents.correlationId, detachOperationId)),
        ),
    );
    if (history !== undefined) {
      const ids = history;
      await attempt(() => db.delete(deals).where(eq(deals.id, ids.dealId)));
      await attempt(() =>
        db.delete(stages).where(inArray(stages.id, [ids.stageId, ids.otherStageId])),
      );
      await attempt(() => db.delete(pipelines).where(eq(pipelines.id, ids.pipelineId)));
      await attempt(() => db.delete(users).where(eq(users.id, ids.userId)));
    }
    await attempt(async () => {
      const remaining = await db.execute<{ count: string }>(sql`
        SELECT ((SELECT count(*) FROM persons WHERE id IN (${personId}::uuid,${detachPersonId}::uuid))
          +(SELECT count(*) FROM newsletter_person_addresses WHERE id IN (${bindingId}::uuid,${detachBindingId}::uuid))
          +(SELECT count(*) FROM newsletter_exposure_receipts WHERE id=${deliveryId}::uuid))::text AS count
      `);
      assert.equal(remaining.rows[0]?.count, "0", "Owned mutation business rows must be removed");
    });
    assert.equal(cleanupFailures.length, 0, "Every owned mutation cleanup step must succeed");
  }
}
